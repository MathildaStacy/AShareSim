/**
 * AI 入口（M4 上线）。现在显示这次提问会附带的页面上下文和最近操作，方便核对每个页面的 aiContext。
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  currentPageContext,
  formatPageContext,
  formatRecentActions,
} from '../../ai/context';
import * as repo from '../../data/repos';
import { NavBar, Note, SectionTitle } from '../components/ui';
import { useCore } from '../hooks';
import { color, PAD } from '../theme';

/** 默认附带最近 10 条操作（AI_ASSISTANT.md §3）。 */
const RECENT_N = 10;

export function AiScreen() {
  const core = useCore();
  const [page] = useState(() => currentPageContext());
  const [acts, setActs] = useState<repo.Activity[]>([]);
  useEffect(() => {
    repo
      .recentActivity(core.db, RECENT_N, core.sim.accountId)
      .then(setActs)
      .catch(() => undefined);
  }, [core]);
  return (
    <View style={s.page}>
      <NavBar title="AI 助手" sub="M4 上线" back />
      <ScrollView contentContainerStyle={s.pad}>
        <Note style={s.note}>
          AI 助手在 M4 接入（用你自己的 Base URL 和 API
          Key）。下面是这次提问会自动附带的内容：你在看的页面，以及最近{' '}
          {RECENT_N} 条操作。行情、持仓这些数字 AI 会用工具现查，不靠这里。
        </Note>
        <View style={s.card}>
          <SectionTitle
            title={
              '你现在在：' + (page?.ctx.name ?? '（这个页面还没有声明上下文）')
            }
          />
          <Text style={s.mono}>{page ? formatPageContext(page.ctx) : '—'}</Text>
        </View>
        <View style={s.card}>
          <SectionTitle title="最近操作" right={acts.length + ' 条'} />
          <Text style={s.mono}>{formatRecentActions(acts)}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 30 },
  note: { margin: 10 },
  card: { backgroundColor: color.card, marginTop: 8, paddingBottom: 12 },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: color.ink2,
    paddingHorizontal: PAD,
  },
});
