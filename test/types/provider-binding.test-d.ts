import type { ProviderBinding } from "../../src/controller";

const httpRangeBinding: ProviderBinding = {
  objectId: "http-object-v1",
  provider: "http-range",
  locator: "https://data.example/object.bin",
  bytes: 128,
  contentVersion: "version-1",
};

const googleDriveBinding: ProviderBinding = {
  objectId: "drive-object-v1",
  provider: "google-drive",
  fileId: "drive-file-123",
  bytes: 256,
  contentVersion: "version-1",
};

// @ts-expect-error Google Drive bindings must identify their file.
const googleDriveBindingWithoutFileId: ProviderBinding = {
  objectId: "drive-object-invalid",
  provider: "google-drive",
  bytes: 256,
  contentVersion: "version-1",
};

void [httpRangeBinding, googleDriveBinding, googleDriveBindingWithoutFileId];
