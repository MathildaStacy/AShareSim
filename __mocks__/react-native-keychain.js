/**
 * Jest 里的 react-native-keychain：存在内存里（Jest 自动用 node_modules 旁边的 __mocks__）。
 */
const store = new Map();

module.exports = {
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  async setGenericPassword(username, password, options = {}) {
    store.set(options.service ?? '', { username, password });
    return { service: options.service ?? '', storage: 'mock' };
  },
  async getGenericPassword(options = {}) {
    const v = store.get(options.service ?? '');
    return v
      ? { ...v, service: options.service ?? '', storage: 'mock' }
      : false;
  },
  async resetGenericPassword(options = {}) {
    return store.delete(options.service ?? '');
  },
};
