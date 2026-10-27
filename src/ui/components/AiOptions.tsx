import { Check, ChevronDown, Globe, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  capabilitiesOf,
  EFFORT_NAME,
  prettyModel,
  PROVIDER_PRESETS,
  searchAvailability,
} from '../../ai/models';
import type {
  AiProvider,
  ConversationConfig,
  ModelCapabilities,
  ModelEntry,
} from '../../ai/types';
import { color } from '../theme';

export function AiSheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const safe = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.mask}>
        <Pressable
          style={s.backdrop}
          onPress={onClose}
          accessibilityLabel="关闭弹层"
        />
        <View style={[s.sheet, { paddingBottom: Math.max(12, safe.bottom) }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={s.touch}
              accessibilityLabel="关闭"
            >
              <X size={21} color={color.ink2} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
export function ProviderMark({ provider }: { provider: AiProvider }) {
  const p = PROVIDER_PRESETS[provider.kind];
  return (
    <View style={[s.mark, { backgroundColor: p.color }]}>
      <Text style={s.markText}>{p.initials}</Text>
    </View>
  );
}
export function CapabilityTags({ caps }: { caps: ModelCapabilities }) {
  const tags = [
    ...(caps.known || caps.thinking !== null ? [] : ['能力未知']),
    ...(caps.thinking === null
      ? []
      : caps.thinking.length
      ? [
          caps.thinking.length === 1
            ? '始终思考'
            : caps.thinking.length === 2
            ? '思考开关'
            : '思考 ' +
              caps.thinking
                .filter(x => x !== 'off')
                .map(x => EFFORT_NAME[x])
                .join(' / '),
        ]
      : ['直接回答']),
    ...(caps.search === true ? ['联网搜索'] : []),
    ...(caps.context
      ? [(caps.context / 1000).toLocaleString('zh-CN') + 'K 上下文']
      : []),
    ...(caps.tools === false
      ? ['无 App 工具']
      : caps.tools === null
      ? ['工具能力未知']
      : []),
  ];
  return (
    <View style={s.tags}>
      {tags.map(t => (
        <Text
          key={t}
          style={[
            s.tag,
            t.includes('未知') || t === '无 App 工具' ? s.warn : null,
          ]}
        >
          {t}
        </Text>
      ))}
    </View>
  );
}
export function ModelPicker({
  visible,
  providers,
  config,
  onClose,
  onSelect,
  onManage,
  searchOnly = false,
}: {
  visible: boolean;
  providers: AiProvider[];
  config: ConversationConfig | null;
  onClose: () => void;
  onSelect: (p: AiProvider, m: ModelEntry) => void;
  onManage: () => void;
  searchOnly?: boolean;
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('');
  const models = providers
    .filter(p => !filter || filter === p.id)
    .flatMap(p =>
      p.models
        .filter(
          m =>
            m.enabled &&
            capabilitiesOf(p, m).chat &&
            (!searchOnly || searchAvailability(p, m).ok) &&
            (p.name + ' ' + m.id + ' ' + (m.name ?? ''))
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .map(m => ({ p, m })),
    );
  return (
    <AiSheet
      title={searchOnly ? '选择能搜索的模型' : '选择模型'}
      visible={visible}
      onClose={onClose}
    >
      <Pressable style={s.manage} onPress={onManage} accessibilityRole="button">
        <Text style={s.link}>管理供应商与模型 ›</Text>
      </Pressable>
      <TextInput
        style={s.input}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索模型名或供应商"
        placeholderTextColor={color.ink3}
        accessibilityLabel="搜索可用模型"
      />
      <ScrollView
        horizontal
        style={s.filters}
        contentContainerStyle={s.filterPad}
        showsHorizontalScrollIndicator={false}
      >
        {[{ id: '', name: '全部' }, ...providers].map(p => (
          <Pressable
            key={p.id}
            style={[s.filter, filter === p.id && s.active]}
            onPress={() => setFilter(p.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === p.id }}
          >
            <Text style={filter === p.id ? s.link : s.sub}>{p.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={models}
        keyboardShouldPersistTaps="handled"
        keyExtractor={x => x.p.id + ':' + x.m.id}
        style={s.modelList}
        ListEmptyComponent={
          <Text style={s.empty}>
            没有匹配的已启用模型，请在供应商里添加或启用。
          </Text>
        }
        renderItem={({ item: { p, m } }) => {
          const selected = config?.providerId === p.id && config.model === m.id;
          return (
            <Pressable
              style={[s.model, selected && s.selected]}
              onPress={() => onSelect(p, m)}
              accessibilityRole="radio"
              accessibilityLabel={p.name + ' ' + m.id}
              accessibilityState={{ selected }}
            >
              <ProviderMark provider={p} />
              <View style={s.grow}>
                <Text style={s.modelTitle}>{prettyModel(m.id)}</Text>
                <Text style={s.sub}>{p.name + ' · ' + m.id}</Text>
                <CapabilityTags caps={capabilitiesOf(p, m)} />
              </View>
              {selected ? <Check size={20} color={color.learn} /> : null}
            </Pressable>
          );
        }}
      />
    </AiSheet>
  );
}
export function EffortPicker({
  visible,
  caps,
  config,
  onClose,
  onSelect,
  onManage,
}: {
  visible: boolean;
  caps: ModelCapabilities | null;
  config: ConversationConfig | null;
  onClose: () => void;
  onSelect: (e: ConversationConfig['effort']) => void;
  onManage: () => void;
}) {
  const levels = caps?.thinking ?? [];
  return (
    <AiSheet title="思考强度" visible={visible} onClose={onClose}>
      <ScrollView style={s.modelList}>
        <Text style={s.explain}>
          {!caps || caps.thinking === null
            ? '模型的思考能力还没标注。请在供应商里按实际接口能力标注。'
            : !levels.length
            ? '这个模型不支持调节思考，直接回答。'
            : levels.length === 1
            ? '这个模型始终思考，无法关闭。'
            : '只显示这个模型可用的档位。强度越高通常越慢，并可能增加输出用量。'}
        </Text>
        {levels.map(e => (
          <Pressable
            key={e}
            style={s.option}
            onPress={() => onSelect(e)}
            accessibilityRole="radio"
            accessibilityLabel={'思考 ' + EFFORT_NAME[e]}
            accessibilityState={{ selected: config?.effort === e }}
          >
            <Text style={s.modelTitle}>{EFFORT_NAME[e]}</Text>
            {config?.effort === e ? (
              <Check size={20} color={color.learn} />
            ) : null}
          </Pressable>
        ))}
        {caps?.thinking === null ? (
          <Pressable
            style={s.option}
            onPress={onManage}
            accessibilityRole="button"
          >
            <Text style={s.link}>去标注模型能力 ›</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </AiSheet>
  );
}
export function SearchUnavailable({
  visible,
  reason,
  onClose,
  onChoose,
}: {
  visible: boolean;
  reason: string;
  onClose: () => void;
  onChoose: () => void;
}) {
  return (
    <AiSheet title="当前模型无法搜索" visible={visible} onClose={onClose}>
      <View style={s.explain}>
        <Globe size={24} color={color.ink2} />
        <Text style={s.reason}>{reason}</Text>
        <Text style={s.sub}>
          搜索由供应商提供，可能按次额外计费。切换模型后，只有你主动开启搜索才会使用。
        </Text>
        <Pressable
          style={s.option}
          onPress={onChoose}
          accessibilityRole="button"
        >
          <Text style={s.link}>查看能搜索的模型</Text>
          <ChevronDown size={18} color={color.learn} />
        </Pressable>
      </View>
    </AiSheet>
  );
}
const s = StyleSheet.create({
  mask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16,24,32,.35)',
  },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: color.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '85%',
  },
  handle: {
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CED4D8',
    alignSelf: 'center',
    marginTop: 9,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20 },
  title: { fontSize: 19, fontWeight: '600', color: color.ink, flex: 1 },
  touch: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manage: {
    alignSelf: 'flex-end',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  link: { color: color.learn, fontSize: 13, fontWeight: '500' },
  input: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 10,
    fontSize: 14,
    color: color.ink,
    minHeight: 48,
  },
  filters: { flexGrow: 0 },
  filterPad: { gap: 8, paddingHorizontal: 16 },
  filter: {
    minHeight: 48,
    paddingHorizontal: 13,
    justifyContent: 'center',
    borderRadius: 12,
  },
  active: { backgroundColor: color.learnBg },
  modelList: { flexGrow: 0 },
  model: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  selected: { backgroundColor: '#F1F8F7' },
  mark: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontWeight: '700', fontSize: 15, color: '#FFFFFF' },
  grow: { flex: 1 },
  modelTitle: { fontSize: 15, fontWeight: '500', color: color.ink },
  sub: { fontSize: 12, lineHeight: 18, color: color.ink2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  tag: {
    fontSize: 10,
    color: color.learn,
    backgroundColor: color.learnBg,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  warn: { color: color.warnInk, backgroundColor: color.warnBg },
  empty: { padding: 24, fontSize: 14, color: color.ink2, lineHeight: 22 },
  explain: { padding: 20, fontSize: 14, lineHeight: 22, color: color.ink2 },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  reason: {
    fontSize: 16,
    fontWeight: '500',
    color: color.ink,
    marginVertical: 14,
  },
});
