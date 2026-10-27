/**
 * AI 服务配置（PRODUCT_DESIGN §6.5、M4 界面清单「编辑服务」）：配置存在 settings 表（aiServices），
 * API Key 存 Android Keystore（react-native-keychain），代码、日志、记忆、上下文页都不出现 Key。
 */
import * as Keychain from 'react-native-keychain';
import type { Db } from '../data/db';
import * as repo from '../data/repos';
import { endpointOf } from './protocol';
import {
  DEFAULT_AI_PREFS,
  type AiPrefs,
  type AiService,
  type Effort,
  type Price,
  type Protocol,
  type AiProvider,
  type ConversationConfig,
  type ProviderKind,
} from './types';
import {
  capabilitiesOf,
  normaliseConfig,
  PROVIDER_PRESETS,
  resolvedService,
} from './models';

// ---------- Key ----------

export interface KeyStore {
  get(serviceId: string): Promise<string | null>;
  set(serviceId: string, key: string): Promise<void>;
  remove(serviceId: string): Promise<void>;
}

const keychainService = (id: string) => 'asharesim.ai.' + id;

export const keychainStore: KeyStore = {
  async get(id) {
    const r = await Keychain.getGenericPassword({
      service: keychainService(id),
    });
    return r ? r.password : null;
  },
  async set(id, key) {
    await Keychain.setGenericPassword('api-key', key, {
      service: keychainService(id),
      // 不要求指纹：每次提问都要读 Key
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
  },
  async remove(id) {
    await Keychain.resetGenericPassword({ service: keychainService(id) });
  },
};

// ---------- 配置 ----------

export async function loadServices(db: Db): Promise<AiService[]> {
  const providers = await loadProviders(db);
  const prefs = await loadPrefs(db);
  return providers.flatMap(p =>
    p.models
      .filter(m => m.enabled)
      .flatMap(m => {
        const cfg = normaliseConfig(
          prefs.lastConfig?.providerId === p.id &&
            prefs.lastConfig.model === m.id
            ? prefs.lastConfig
            : { providerId: p.id, model: m.id, effort: 'low', search: false },
          providers,
        );
        const service = resolvedService(providers, cfg);
        return service ? [service] : [];
      }),
  );
}

export async function saveServices(
  db: Db,
  services: AiService[],
): Promise<void> {
  await repo.setSetting(db, 'aiServices', services);
  const grouped = new Map<string, AiProvider>();
  for (const s of services) {
    const p = grouped.get(s.id) ?? {
      id: s.id,
      kind: s.providerKind ?? 'custom',
      name: s.name,
      protocol: s.protocol,
      baseUrl: s.baseUrl,
      auth: s.auth,
      cache: s.cache,
      keyTail: s.keyTail,
      models: [],
    };
    p.models.push({
      id: s.model,
      enabled: true,
      price: s.price,
      ...(s.capabilities ? { overrides: s.capabilities } : {}),
    });
    grouped.set(s.id, p);
  }
  const providers = [...grouped.values()];
  await saveProviders(db, providers);
  const prefs = await loadPrefs(db);
  const selected =
    services.find(s => s.id === prefs.activeService) ?? services[0];
  if (selected && !resolvedService(providers, prefs.lastConfig)) {
    await savePrefs(db, {
      ...prefs,
      lastConfig: normaliseConfig(
        {
          providerId: selected.id,
          model: selected.model,
          effort: selected.effort,
          search: selected.search ?? false,
        },
        providers,
      ),
    });
  }
}

/** v0.3 每个服务迁成一个供应商和已启用模型，沿用 id，安全存储里的 Key 不移动、不重写。 */
export async function loadProviders(db: Db): Promise<AiProvider[]> {
  const saved = await repo.getSetting<AiProvider[] | null>(
    db,
    'aiProviders',
    null,
  );
  if (saved != null) {
    return saved;
  }
  return db.transaction(async tx => {
    const existing = await repo.getSetting<AiProvider[] | null>(
      tx,
      'aiProviders',
      null,
    );
    if (existing != null) {
      return existing;
    }
    const legacy = await repo.getSetting<AiService[]>(tx, 'aiServices', []);
    const providers: AiProvider[] = legacy.map(s => ({
      id: s.id,
      kind: 'custom',
      name: s.name,
      protocol: s.protocol,
      baseUrl: s.baseUrl,
      auth: s.auth,
      cache: s.cache,
      keyTail: s.keyTail,
      models: [{ id: s.model, enabled: true, price: s.price }],
    }));
    await repo.setSetting(tx, 'aiProviders', providers);
    const prefs = await loadPrefs(tx);
    const last = legacy.find(s => s.id === prefs.activeService) ?? legacy[0];
    if (last && !prefs.lastConfig) {
      await savePrefs(tx, {
        ...prefs,
        lastConfig: normaliseConfig(
          {
            providerId: last.id,
            model: last.model,
            effort: last.effort,
            search: false,
          },
          providers,
        ),
      });
    }
    return providers;
  });
}

export const saveProviders = (db: Db, providers: AiProvider[]) =>
  repo.setSetting(db, 'aiProviders', providers);

export async function defaultConversationConfig(
  db: Db,
): Promise<ConversationConfig | null> {
  const providers = await loadProviders(db);
  const prefs = await loadPrefs(db);
  if (resolvedService(providers, prefs.lastConfig)) {
    return normaliseConfig(prefs.lastConfig!, providers);
  }
  const sorted = [...providers].sort(
    (a, b) =>
      Number(b.id === prefs.activeService) -
      Number(a.id === prefs.activeService),
  );
  for (const p of sorted) {
    const m = p.models.find(x => x.enabled && capabilitiesOf(p, x).chat);
    if (m) {
      return normaliseConfig(
        { providerId: p.id, model: m.id, effort: 'low', search: false },
        providers,
      );
    }
  }
  return null;
}

export function emptyProvider(kind: ProviderKind): AiProvider {
  const preset = PROVIDER_PRESETS[kind];
  return {
    id: newServiceId(),
    kind,
    name: kind === 'custom' ? '' : preset.name,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    auth: kind === 'anthropic' ? 'x-api-key' : 'bearer',
    cache: 'auto',
    keyTail: '',
    models: [],
  };
}

export async function setProviderCache(
  db: Db,
  id: string,
  cache: AiProvider['cache'],
): Promise<void> {
  await saveProviders(
    db,
    (await loadProviders(db)).map(p => (p.id === id ? { ...p, cache } : p)),
  );
}

export async function loadPrefs(db: Db): Promise<AiPrefs> {
  return {
    ...DEFAULT_AI_PREFS,
    ...(await repo.getSetting<Partial<AiPrefs>>(db, 'aiPrefs', {})),
  };
}

export async function savePrefs(db: Db, prefs: AiPrefs): Promise<void> {
  await repo.setSetting(db, 'aiPrefs', prefs);
}

/** 每台设备固定的缓存 key（OpenAI prompt_cache_key，§6.3）。 */
export async function installId(db: Db): Promise<string> {
  let id = await repo.getSetting<string>(db, 'installId', '');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    await repo.setSetting(db, 'installId', id);
  }
  return 'asharesim-' + id;
}

// ---------- 表单 ----------

export interface ServiceForm {
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  effort: Effort;
  cache: 'auto' | 'off';
  auth: 'x-api-key' | 'bearer';
  /** 新填的 Key；空表示不改（编辑时）。 */
  key: string;
  /** 价格（美元 / 百万 tokens），空表示不填。 */
  priceInput: string;
  priceCacheRead: string;
  priceCacheWrite: string;
  priceOutput: string;
}

export type ServiceField = 'name' | 'baseUrl' | 'model' | 'key' | 'price';

export const SERVICE_FIELD_NAME: Record<ServiceField, string> = {
  name: '名称',
  baseUrl: 'Base URL',
  model: '模型',
  key: 'API Key',
  price: '价格',
};

export const DEFAULT_BASE_URL: Record<Protocol, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  chat: 'https://api.openai.com/v1',
};

export function emptyForm(protocol: Protocol = 'anthropic'): ServiceForm {
  return {
    name: '',
    protocol,
    baseUrl: DEFAULT_BASE_URL[protocol],
    model: '',
    effort: 'low',
    cache: 'auto',
    auth: 'x-api-key',
    key: '',
    priceInput: '',
    priceCacheRead: '',
    priceCacheWrite: '',
    priceOutput: '',
  };
}

const milliText = (v: number) => String(v / 1000);

export function formOf(s: AiService): ServiceForm {
  return {
    name: s.name,
    protocol: s.protocol,
    baseUrl: s.baseUrl,
    model: s.model,
    effort: s.effort,
    cache: s.cache,
    auth: s.auth,
    key: '',
    priceInput: s.price ? milliText(s.price.input) : '',
    priceCacheRead: s.price ? milliText(s.price.cacheRead) : '',
    priceCacheWrite: s.price ? milliText(s.price.cacheWrite) : '',
    priceOutput: s.price ? milliText(s.price.output) : '',
  };
}

/** 美元 → 千分之一美元（整数）。 */
function parseUsd(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) {
    return null;
  }
  return Math.round(Number(t) * 1000);
}

export type ServiceParse =
  | { ok: true; service: Omit<AiService, 'id' | 'keyTail'>; key: string | null }
  | { ok: false; errors: Partial<Record<ServiceField, string>> };

/**
 * 校验表单。hasKey：编辑已有服务时 Key 已经存过了，可以不填。
 * 价格要么都不填，要么 4 项都填。
 */
export function parseServiceForm(
  f: ServiceForm,
  hasKey: boolean,
): ServiceParse {
  const errors: Partial<Record<ServiceField, string>> = {};
  const name = f.name.trim();
  if (!name) {
    errors.name = '起个名字，例如「Claude 中转」';
  } else if ([...name].length > 20) {
    errors.name = '名字最多 20 个字';
  }
  const baseUrl = f.baseUrl.trim();
  try {
    endpointOf(f.protocol, baseUrl);
  } catch (e) {
    errors.baseUrl = (e as Error).message;
  }
  const model = f.model.trim();
  if (!model) {
    errors.model = '填模型名，例如 claude-sonnet-5-5';
  } else if (/\s/.test(model)) {
    errors.model = '模型名里不能有空格';
  }
  const key = f.key.trim();
  if (!key && !hasKey) {
    errors.key = '填 API Key（只存在本机 Android Keystore）';
  } else if (key && /\s/.test(key)) {
    errors.key = 'Key 里不能有空格或换行';
  }
  const texts = [
    f.priceInput,
    f.priceCacheRead,
    f.priceCacheWrite,
    f.priceOutput,
  ];
  let price: Price | null = null;
  if (texts.some(t => t.trim())) {
    const v = texts.map(parseUsd);
    if (v.some(x => x == null)) {
      errors.price =
        '价格要 4 项都填（美元 / 百万 tokens，最多 3 位小数），或者都不填';
    } else {
      price = {
        input: v[0]!,
        cacheRead: v[1]!,
        cacheWrite: v[2]!,
        output: v[3]!,
      };
    }
  }
  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    service: {
      name,
      protocol: f.protocol,
      baseUrl,
      model,
      effort: f.effort,
      cache: f.cache,
      auth: f.protocol === 'anthropic' ? f.auth : 'bearer',
      price,
    },
    key: key || null,
  };
}

export const newServiceId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const keyTailOf = (key: string) => key.slice(-4);
