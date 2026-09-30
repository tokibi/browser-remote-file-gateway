const DATABASE_NAME = "remote-file-gateway";
const BINDING_STORE = "provider-bindings";
const IDENTITY_STORE = "object-identities";
const STATE_STORE = "state";
const SNAPSHOT_KEY = "binding-snapshot";
const MAX_UINT64 = (1n << 64n) - 1n;
const PROTOCOL_VERSIONS = Object.freeze([1]);
const REQUIRED_CAPABILITIES = Object.freeze(["http-range", "bounded-opfs-cache"]);

export interface GatewayOptions {
  virtualBase?: string;
  protocolVersions?: readonly number[];
  requiredCapabilities?: readonly string[];
}

export interface RegisterOptions extends GatewayOptions {
  scope?: string;
  serviceWorkerUrl?: string;
  controlTimeoutMs?: number;
  maxFullObjectCacheBytes?: number;
}

export interface ConnectOptions extends GatewayOptions {
  registration: ServiceWorkerRegistration;
}

interface BindingCommon {
  objectId: string;
  bytes: number;
  contentVersion: string;
  mimeType?: string;
}

export interface GoogleDriveBinding extends BindingCommon {
  provider: "google-drive";
  fileId: string;
  apiBase?: string;
}

export interface HttpRangeBinding extends BindingCommon {
  provider: "http-range";
  locator: string;
}

export type ProviderBinding = GoogleDriveBinding | HttpRangeBinding;
type NormalizedBinding =
  | (Omit<GoogleDriveBinding, "mimeType" | "apiBase"> & { mimeType: string; apiBase: string })
  | (Omit<HttpRangeBinding, "mimeType"> & { mimeType: string });

export interface GatewayCredential {
  accessToken: string;
  generation: string;
  expiresAt: number;
}

export interface PublicationResult {
  revision: bigint;
  idempotent: boolean;
}

export interface GatewayDiagnostics {
  resolverCalls: Array<{
    objectId: string;
    provider: ProviderBinding["provider"];
    credentialGeneration: string;
  }>;
  providerRequests: Array<{
    operation: "metadata" | "media";
    method: string;
    range: string | null;
    status: number;
    responseBytes: number;
    credentialGeneration: string;
    durationMs: number;
    streamed?: boolean;
  }>;
  virtualRequests: Array<{
    objectId: string;
    method: string;
    range: string | null;
    status: number;
  }>;
  cacheHits: Array<{ objectId: string; bytes: number }>;
  cacheMisses: Array<{ objectId: string }>;
  cacheWrites: Array<{ objectId: string; bytes: number }>;
  cacheBypasses: Array<{ objectId: string; bytes: number; maxFullObjectCacheBytes: number }>;
  cacheRejections: Array<{ objectId: string; reason: string }>;
  failures: Array<{ objectId: string; code: string; status: number }>;
}

interface BindingSnapshot {
  revision: string;
  serialized: string;
}
type ImmutableIdentity = {
  objectId: string;
  provider: ProviderBinding["provider"];
  bytes: number;
  contentVersion: string;
  fileId?: string;
};
interface HandshakeResponse {
  protocolVersion: number;
  virtualBase: string;
  capabilities: string[];
}

export class RemoteFileGatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RemoteFileGatewayError";
    this.code = code;
  }
}

export class RemoteFileGateway {
  #scope: string;
  #virtualBase: string;
  #registration: ServiceWorkerRegistration;
  #protocolVersions: readonly number[];
  #requiredCapabilities: readonly string[];
  #handshake: { controller: ServiceWorker; promise: Promise<ServiceWorker> } | undefined;
  #controllerGeneration = 0;
  #controllerChanged: () => void;
  #closed = false;

  static async initialize(options: RegisterOptions = {}): Promise<RemoteFileGateway> {
    return RemoteFileGateway.register(options);
  }

  static async register(options: RegisterOptions = {}): Promise<RemoteFileGateway> {
    const scope = normalizeScope(options.scope ?? "/");
    const virtualBase = normalizeScope(options.virtualBase ?? "/remote-file-gateway/");
    const serviceWorkerUrl = options.serviceWorkerUrl ?? "/remote-file-gateway/service-worker.js";
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
      scope,
      type: "module",
    });
    await navigator.serviceWorker.ready;
    await waitForController(
      registration,
      scope,
      new URL(serviceWorkerUrl, location.origin).href,
      options.controlTimeoutMs ?? 20_000,
    );
    const instance = new RemoteFileGateway(scope, virtualBase, registration, options);
    try {
      await instance.#ensureHandshake();
      await instance.configureCache(options.maxFullObjectCacheBytes ?? 0);
      return instance;
    } catch (error) {
      await instance.close();
      throw error;
    }
  }

  static async connect(options: ConnectOptions = {} as ConnectOptions): Promise<RemoteFileGateway> {
    const registration = options.registration;
    if (!registration || typeof registration.scope !== "string") {
      throw new RemoteFileGatewayError(
        "RC_GATEWAY_REGISTRATION_NOT_CONTROLLING",
        "A Service Worker registration is required",
      );
    }
    const scopeUrl = new URL(registration.scope);
    if (scopeUrl.origin !== location.origin) {
      throw new RemoteFileGatewayError(
        "RC_GATEWAY_REGISTRATION_NOT_CONTROLLING",
        "The Service Worker registration is not same-origin",
      );
    }
    const virtualBase = normalizeScope(options.virtualBase ?? "/remote-file-gateway/");
    const instance = new RemoteFileGateway(scopeUrl.pathname, virtualBase, registration, options);
    try {
      await instance.#ensureHandshake();
      return instance;
    } catch (error) {
      await instance.close();
      throw error;
    }
  }

  constructor(
    scope: string,
    virtualBase: string,
    registration: ServiceWorkerRegistration,
    options: GatewayOptions = {},
  ) {
    this.#scope = scope;
    this.#virtualBase = virtualBase;
    this.#registration = registration;
    this.#protocolVersions = normalizeProtocolVersions(
      options.protocolVersions ?? PROTOCOL_VERSIONS,
    );
    this.#requiredCapabilities = normalizeCapabilities(
      options.requiredCapabilities ?? REQUIRED_CAPABILITIES,
    );
    this.#controllerChanged = () => {
      this.#controllerGeneration += 1;
      this.#handshake = undefined;
    };
    navigator.serviceWorker.addEventListener("controllerchange", this.#controllerChanged);
  }

  get registration() {
    return this.#registration;
  }

  get scope() {
    return this.#scope;
  }

  virtualUri(objectId: string): string {
    this.#requireActive();
    return new URL(`${this.#virtualBase}objects/${normalizeObjectId(objectId)}`, location.origin)
      .href;
  }

  async publishBindings(
    revision: bigint,
    bindings: readonly ProviderBinding[],
  ): Promise<PublicationResult> {
    this.#requireActive();
    const normalizedRevision = normalizeRevision(revision);
    const normalizedBindings = normalizeBindings(bindings, this.#virtualBase);
    const serialized = JSON.stringify(normalizedBindings);
    const database = await openDatabase();
    let publication: PublicationResult;
    try {
      publication = await new Promise<PublicationResult>((resolve, reject) => {
        const transaction = database.transaction(
          [BINDING_STORE, IDENTITY_STORE, STATE_STORE],
          "readwrite",
        );
        const bindingStore = transaction.objectStore(BINDING_STORE);
        const identityStore = transaction.objectStore(IDENTITY_STORE);
        const stateStore = transaction.objectStore(STATE_STORE);
        const currentRequest = stateStore.get(SNAPSHOT_KEY);
        const identityRequests = normalizedBindings.map((binding) =>
          identityStore.get(binding.objectId),
        );
        let result: PublicationResult | undefined;
        let operationError: unknown;
        let currentLoaded = false;
        let remainingIdentities = identityRequests.length;
        let applied = false;
        const applyPublication = () => {
          if (applied || !currentLoaded || remainingIdentities !== 0) return;
          applied = true;
          try {
            const current = currentRequest.result as BindingSnapshot | undefined;
            const currentRevision = current ? BigInt(current.revision) : null;
            if (currentRevision !== null && normalizedRevision < currentRevision) {
              throw new RemoteFileGatewayError(
                "RC_BINDING_REVISION_STALE",
                "Provider binding revision is older than the current revision",
              );
            }
            if (currentRevision === normalizedRevision) {
              if (current?.serialized !== serialized) {
                throw new RemoteFileGatewayError(
                  "RC_BINDING_REVISION_CONFLICT",
                  "Provider binding revision has conflicting content",
                );
              }
              result = { revision: normalizedRevision, idempotent: true };
              return;
            }
            const currentIdentities = new Map<string, ImmutableIdentity>(
              current
                ? (JSON.parse(current.serialized) as NormalizedBinding[]).map(
                    (binding): [string, ImmutableIdentity] => [
                      binding.objectId,
                      immutableIdentity(binding),
                    ],
                  )
                : [],
            );
            normalizedBindings.forEach((binding, index) => {
              const knownIdentity =
                (identityRequests[index].result as ImmutableIdentity | undefined) ??
                currentIdentities.get(binding.objectId);
              assertSameIdentity(knownIdentity, binding);
            });
            bindingStore.clear();
            for (const binding of normalizedBindings) {
              bindingStore.put({ ...binding, bindingRevision: normalizedRevision.toString() });
              identityStore.put(immutableIdentity(binding));
            }
            stateStore.put({
              key: SNAPSHOT_KEY,
              revision: normalizedRevision.toString(),
              serialized,
            });
            result = { revision: normalizedRevision, idempotent: false };
          } catch (error) {
            operationError = error;
            transaction.abort();
          }
        };
        currentRequest.onsuccess = () => {
          currentLoaded = true;
          applyPublication();
        };
        currentRequest.onerror = () => {
          operationError = currentRequest.error;
        };
        for (const request of identityRequests) {
          request.onsuccess = () => {
            remainingIdentities -= 1;
            applyPublication();
          };
          request.onerror = () => {
            operationError = request.error;
          };
        }
        transaction.oncomplete = () =>
          result === undefined
            ? reject(
                new RemoteFileGatewayError(
                  "RC_GATEWAY_ERROR",
                  "Publication completed without a result",
                ),
              )
            : resolve(result);
        transaction.onerror = () => reject(operationError ?? transaction.error);
        transaction.onabort = () => reject(operationError ?? transaction.error);
      });
    } finally {
      database.close();
    }
    await this.#request("REMOTE_FILE_GATEWAY_INVALIDATE_BINDINGS");
    return publication;
  }

  async setCredential(
    provider: string,
    credential: GatewayCredential,
  ): Promise<Pick<GatewayCredential, "generation" | "expiresAt">> {
    this.#requireActive();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(provider)) {
      throw new RemoteFileGatewayError("RC_CREDENTIAL_INVALID", "Provider name is invalid");
    }
    if (
      !credential ||
      typeof credential.accessToken !== "string" ||
      credential.accessToken.length < 8 ||
      credential.accessToken.length > 4096 ||
      typeof credential.generation !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(credential.generation) ||
      !Number.isSafeInteger(credential.expiresAt)
    ) {
      throw new RemoteFileGatewayError("RC_CREDENTIAL_INVALID", "Credential is invalid");
    }
    return this.#request<Pick<GatewayCredential, "generation" | "expiresAt">>(
      "REMOTE_FILE_GATEWAY_SET_CREDENTIAL",
      { provider, credential },
    );
  }

  async clearCredential(provider: string): Promise<void> {
    this.#requireActive();
    normalizeProvider(provider);
    return this.#request<void>("REMOTE_FILE_GATEWAY_CLEAR_CREDENTIAL", { provider });
  }

  configureCache(maxFullObjectCacheBytes: number): Promise<{ maxFullObjectCacheBytes: number }> {
    this.#requireActive();
    if (!Number.isSafeInteger(maxFullObjectCacheBytes) || maxFullObjectCacheBytes < 0) {
      throw new RemoteFileGatewayError(
        "RC_CACHE_POLICY_INVALID",
        "maxFullObjectCacheBytes must be a non-negative safe integer",
      );
    }
    return this.#request<{ maxFullObjectCacheBytes: number }>(
      "REMOTE_FILE_GATEWAY_CONFIGURE_CACHE",
      { maxFullObjectCacheBytes },
    );
  }

  diagnostics(): Promise<GatewayDiagnostics> {
    this.#requireActive();
    return this.#request<GatewayDiagnostics>("REMOTE_FILE_GATEWAY_GET_DIAGNOSTICS");
  }

  resetDiagnostics(): Promise<void> {
    this.#requireActive();
    return this.#request<void>("REMOTE_FILE_GATEWAY_RESET_DIAGNOSTICS");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#handshake = undefined;
    navigator.serviceWorker.removeEventListener("controllerchange", this.#controllerChanged);
  }

  async #request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    this.#requireActive();
    const controller = await this.#ensureHandshake();
    return this.#postMessage<T>(controller, type, payload);
  }

  #postMessage<T>(
    controller: ServiceWorker,
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new RemoteFileGatewayError("RC_GATEWAY_TIMEOUT", `${type} timed out`));
      }, 20_000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        if (event.data?.ok === false) {
          reject(
            new RemoteFileGatewayError(
              event.data.code ?? "RC_GATEWAY_ERROR",
              event.data.message ?? `${type} failed`,
            ),
          );
          return;
        }
        resolve(event.data?.result as T);
      };
      try {
        controller.postMessage({ type, ...payload }, [channel.port2]);
      } catch (error) {
        clearTimeout(timeout);
        channel.port1.close();
        reject(error);
      }
    });
  }

  #boundController(): ServiceWorker | null {
    const controller = navigator.serviceWorker.controller;
    const scopeUrl = new URL(this.#scope, location.origin).href;
    return controlsActiveRegistration(controller, this.#registration, scopeUrl) ? controller : null;
  }

  async #ensureHandshake(): Promise<ServiceWorker> {
    this.#requireActive();
    const controller = this.#boundController();
    if (!controller) {
      throw new RemoteFileGatewayError(
        "RC_GATEWAY_REGISTRATION_NOT_CONTROLLING",
        "The specified Service Worker registration does not control this page",
      );
    }
    if (this.#handshake?.controller === controller) return this.#handshake.promise;

    const generation = this.#controllerGeneration;
    const promise = this.#postMessage<HandshakeResponse>(controller, "REMOTE_FILE_GATEWAY_HELLO", {
      protocolVersions: [...this.#protocolVersions],
      virtualBase: this.#virtualBase,
    }).then((result) => {
      if (
        generation !== this.#controllerGeneration ||
        controller !== navigator.serviceWorker.controller ||
        controller !== this.#registration.active
      ) {
        throw new RemoteFileGatewayError(
          "RC_GATEWAY_REGISTRATION_NOT_CONTROLLING",
          "Service Worker control changed during the Gateway handshake",
        );
      }
      if (!this.#protocolVersions.includes(result?.protocolVersion)) {
        throw new RemoteFileGatewayError(
          "RC_GATEWAY_PROTOCOL_UNSUPPORTED",
          "The Service Worker selected an unsupported Gateway protocol version",
        );
      }
      if (result?.virtualBase !== this.#virtualBase) {
        throw new RemoteFileGatewayError(
          "RC_GATEWAY_VIRTUAL_BASE_MISMATCH",
          "The Service Worker Gateway virtual base does not match",
        );
      }
      const capabilities = Array.isArray(result?.capabilities) ? result.capabilities : [];
      const missing = this.#requiredCapabilities.find((value) => !capabilities.includes(value));
      if (missing) {
        throw new RemoteFileGatewayError(
          "RC_GATEWAY_CAPABILITY_UNSUPPORTED",
          `The Service Worker Gateway does not provide ${missing}`,
        );
      }
      return controller;
    });
    this.#handshake = { controller, promise };
    try {
      return await promise;
    } catch (error) {
      if (this.#handshake?.promise === promise) this.#handshake = undefined;
      if (
        error instanceof RemoteFileGatewayError &&
        error.code === "RC_GATEWAY_REGISTRATION_NOT_CONTROLLING" &&
        generation !== this.#controllerGeneration &&
        this.#boundController()
      ) {
        return this.#ensureHandshake();
      }
      throw error;
    }
  }

  #requireActive() {
    if (this.#closed) {
      throw new RemoteFileGatewayError("RC_REMOTE_FILE_GATEWAY_CLOSED", "Gateway is closed");
    }
  }
}

function normalizeProvider(provider: string): string {
  if (typeof provider !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(provider)) {
    throw new RemoteFileGatewayError("RC_CREDENTIAL_INVALID", "Provider name is invalid");
  }
  return provider;
}

function normalizeProtocolVersions(values: readonly number[]): readonly number[] {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new RemoteFileGatewayError(
      "RC_GATEWAY_PROTOCOL_UNSUPPORTED",
      "At least one positive protocol version is required",
    );
  }
  return Object.freeze([...new Set(values)]);
}

function normalizeCapabilities(values: readonly string[]): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new RemoteFileGatewayError(
      "RC_GATEWAY_CAPABILITY_UNSUPPORTED",
      "Required capabilities must be strings",
    );
  }
  return Object.freeze([...new Set(values)]);
}

function normalizeScope(value: string): string {
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || !url.pathname.endsWith("/")) {
    throw new RemoteFileGatewayError(
      "RC_SCOPE_INVALID",
      "Service Worker scope must be a same-origin path ending in slash",
    );
  }
  return url.pathname;
}

function normalizeRevision(value: bigint): bigint {
  if (typeof value === "bigint" && value >= 0n && value <= MAX_UINT64) return value;
  throw new RemoteFileGatewayError(
    "RC_BINDING_REVISION_INVALID",
    "Provider binding revision must be a bigint in uint64 range",
  );
}

function normalizeObjectId(value: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(value)) {
    throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Object ID is invalid");
  }
  return value;
}

function normalizeBindings(
  bindings: readonly ProviderBinding[],
  virtualBase: string,
): NormalizedBinding[] {
  if (!Array.isArray(bindings)) {
    throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Bindings must be an array");
  }
  const objectIds = new Set<string>();
  return bindings
    .map((candidate): NormalizedBinding => {
      const objectId = normalizeObjectId(candidate?.objectId);
      if (objectIds.has(objectId)) {
        throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Object IDs must be unique");
      }
      objectIds.add(objectId);
      const bytes = candidate.bytes;
      if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Object size is invalid");
      }
      if (
        typeof candidate.contentVersion !== "string" ||
        candidate.contentVersion.length === 0 ||
        candidate.contentVersion.length > 512
      ) {
        throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Content version is required");
      }
      const mimeType = candidate.mimeType ?? "application/octet-stream";
      if (typeof mimeType !== "string" || mimeType.length === 0 || mimeType.length > 255) {
        throw new RemoteFileGatewayError("RC_BINDING_INVALID", "MIME type is invalid");
      }
      if (candidate.provider === "google-drive") {
        if (
          typeof candidate.fileId !== "string" ||
          !/^[A-Za-z0-9_-]{10,256}$/.test(candidate.fileId)
        ) {
          throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Google Drive file ID is invalid");
        }
        const apiBase = new URL(candidate.apiBase ?? "https://www.googleapis.com/");
        const plainBase =
          apiBase.username === "" &&
          apiBase.password === "" &&
          apiBase.search === "" &&
          apiBase.hash === "";
        const google =
          plainBase && apiBase.origin === "https://www.googleapis.com" && apiBase.pathname === "/";
        const localTest =
          plainBase &&
          apiBase.origin === location.origin &&
          apiBase.pathname === "/fake-google-drive/";
        if (!google && !localTest) {
          throw new RemoteFileGatewayError(
            "RC_BINDING_INVALID",
            "Google Drive API base is invalid",
          );
        }
        if (!/^[a-f0-9]{32}$/.test(candidate.contentVersion)) {
          throw new RemoteFileGatewayError(
            "RC_BINDING_INVALID",
            "Google Drive content version must be an MD5 checksum",
          );
        }
        return {
          objectId,
          provider: "google-drive",
          fileId: candidate.fileId,
          apiBase: apiBase.href,
          bytes,
          contentVersion: candidate.contentVersion,
          mimeType,
        };
      }
      if (candidate.provider === "http-range") {
        const locator = new URL(candidate.locator);
        if (
          !["http:", "https:"].includes(locator.protocol) ||
          (locator.origin === location.origin && locator.pathname.startsWith(virtualBase))
        ) {
          throw new RemoteFileGatewayError("RC_BINDING_INVALID", "HTTP Range locator is invalid");
        }
        return {
          objectId,
          provider: "http-range",
          locator: locator.href,
          bytes,
          contentVersion: candidate.contentVersion,
          mimeType,
        };
      }
      throw new RemoteFileGatewayError("RC_BINDING_INVALID", "Provider is unsupported");
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
}

function immutableIdentity(binding: NormalizedBinding): ImmutableIdentity {
  const identity: ImmutableIdentity = {
    objectId: binding.objectId,
    provider: binding.provider,
    bytes: binding.bytes,
    contentVersion: binding.contentVersion,
  };
  if (binding.provider === "google-drive") identity.fileId = binding.fileId;
  return identity;
}

function assertSameIdentity(
  knownIdentity: ImmutableIdentity | undefined,
  binding: NormalizedBinding,
): void {
  if (!knownIdentity) return;
  const candidate = immutableIdentity(binding);
  if (JSON.stringify(knownIdentity) !== JSON.stringify(candidate)) {
    throw new RemoteFileGatewayError(
      "RC_OBJECT_IDENTITY_CONFLICT",
      `Object ID ${binding.objectId} was already published with different immutable fields`,
    );
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BINDING_STORE)) {
        request.result.createObjectStore(BINDING_STORE, { keyPath: "objectId" });
      }
      if (!request.result.objectStoreNames.contains(STATE_STORE)) {
        request.result.createObjectStore(STATE_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(IDENTITY_STORE)) {
        request.result.createObjectStore(IDENTITY_STORE, { keyPath: "objectId" });
      }
      if (!request.result.objectStoreNames.contains("cache-metadata")) {
        request.result.createObjectStore("cache-metadata", { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForController(
  registration: ServiceWorkerRegistration,
  scope: string,
  expectedScriptUrl: string,
  timeoutMs: number,
): Promise<ServiceWorker> {
  const scopeUrl = new URL(scope, location.origin).href;
  const current = navigator.serviceWorker.controller;
  if (controlsRegistration(current, registration, scopeUrl, expectedScriptUrl)) {
    return Promise.resolve(current);
  }
  return new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      reject(
        new RemoteFileGatewayError(
          "RC_GATEWAY_TIMEOUT",
          "Service Worker did not control the page before timeout",
        ),
      );
    }, timeoutMs);
    function changed() {
      const controller = navigator.serviceWorker.controller;
      if (!controlsRegistration(controller, registration, scopeUrl, expectedScriptUrl)) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      resolve(controller);
    }
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    changed();
  });
}

function controlsRegistration(
  controller: ServiceWorker | null,
  registration: ServiceWorkerRegistration,
  scopeUrl: string,
  expectedScriptUrl: string,
): controller is ServiceWorker {
  return Boolean(
    controller &&
    registration.active &&
    controller.scriptURL === expectedScriptUrl &&
    controller.scriptURL === registration.active.scriptURL &&
    location.href.startsWith(scopeUrl),
  );
}

function controlsActiveRegistration(
  controller: ServiceWorker | null,
  registration: ServiceWorkerRegistration,
  scopeUrl: string,
): controller is ServiceWorker {
  return Boolean(
    controller &&
    registration.active &&
    controller === registration.active &&
    location.href.startsWith(scopeUrl),
  );
}
