/**
 * 分时图和 K 线图（react-native-svg）。数据计算在 chartMath.ts，这里只负责画。
 * 红涨绿跌：K 线阳线空心红、阴线实心绿，和同花顺一致。
 */
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { Li } from '../../engine/units';
import type { KBar } from '../../market/tencent';
import { color } from '../theme';
import { klineView, MINUTES, type MinuteSeries } from './chartMath';

const H = 230;
const FONT = 10;

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, e => setW(Math.round(e.nativeEvent.layout.width))];
}

const fx = (li: number, d: number) => (li / 1000).toFixed(d);

function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y == null) {
      pen = false;
      continue;
    }
    d += (pen ? 'L' : 'M') + xs[i].toFixed(1) + ' ' + y.toFixed(1);
    pen = true;
  }
  return d;
}

export function MinuteChart({
  series,
  prevClose,
  decimals,
  emptyText,
}: {
  series: MinuteSeries | null;
  prevClose: Li | null;
  decimals: number;
  emptyText: string;
}) {
  const [w, onLayout] = useWidth();
  const ph = H * 0.7;
  const vTop = ph + 14;
  const vh = H - vTop - 14;
  const padL = 4;
  const padR = 4;
  const X = (x: number) => padL + ((w - padL - padR) * x) / MINUTES;
  const has = series && series.price.length > 0 && prevClose != null;
  const top = has ? series!.top : (prevClose ?? 0) * 1.01;
  const bot = has ? series!.bottom : (prevClose ?? 0) * 0.99;
  const Y = (v: number) => 6 + ((ph - 12) * (top - v)) / (top - bot || 1);
  return (
    <View style={styles.box} onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.priceLine} stopOpacity={0.16} />
              <Stop offset="1" stopColor={color.priceLine} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[0, 60, 120, 180, 240].map(g => (
            <Line
              key={g}
              x1={X(g)}
              x2={X(g)}
              y1={0}
              y2={ph}
              stroke={color.grid}
              strokeWidth={1}
            />
          ))}
          <Line x1={0} x2={w} y1={ph} y2={ph} stroke={color.grid} />
          {prevClose != null ? (
            <Line
              x1={0}
              x2={w}
              y1={Y(prevClose)}
              y2={Y(prevClose)}
              stroke={color.baseLine}
              strokeDasharray="3,3"
            />
          ) : null}
          {has ? (
            <>
              <SvgText x={4} y={14} fontSize={FONT} fill={color.up}>
                {fx(top, decimals)}
              </SvgText>
              <SvgText x={4} y={ph - 4} fontSize={FONT} fill={color.down}>
                {fx(bot, decimals)}
              </SvgText>
              <SvgText
                x={w - 4}
                y={14}
                fontSize={FONT}
                fill={color.up}
                textAnchor="end"
              >
                {'+' +
                  (((top - prevClose!) / prevClose!) * 100).toFixed(2) +
                  '%'}
              </SvgText>
              <SvgText
                x={w - 4}
                y={ph - 4}
                fontSize={FONT}
                fill={color.down}
                textAnchor="end"
              >
                {(((bot - prevClose!) / prevClose!) * 100).toFixed(2) + '%'}
              </SvgText>
              <Path
                d={
                  linePath(series!.x.map(X), series!.price.map(Y)) +
                  `L${X(series!.x[series!.x.length - 1]).toFixed(1)} ${ph}L${X(
                    series!.x[0],
                  ).toFixed(1)} ${ph}Z`
                }
                fill="url(#area)"
              />
              <Path
                d={linePath(series!.x.map(X), series!.price.map(Y))}
                stroke={color.priceLine}
                strokeWidth={1.3}
                fill="none"
              />
              {series!.avg ? (
                <Path
                  d={linePath(
                    series!.x.map(X),
                    series!.avg.map(v => (v == null ? null : Y(v))),
                  )}
                  stroke={color.avgLine}
                  strokeWidth={1}
                  fill="none"
                />
              ) : null}
              <MinuteVolume series={series!} X={X} top={vTop} h={vh} w={w} />
            </>
          ) : (
            <SvgText
              x={w / 2}
              y={ph / 2}
              fontSize={12}
              fill={color.ink3}
              textAnchor="middle"
            >
              {emptyText}
            </SvgText>
          )}
          <SvgText x={4} y={H - 2} fontSize={FONT} fill={color.ink3}>
            09:30
          </SvgText>
          <SvgText
            x={X(120)}
            y={H - 2}
            fontSize={FONT}
            fill={color.ink3}
            textAnchor="middle"
          >
            11:30/13:00
          </SvgText>
          <SvgText
            x={w - 4}
            y={H - 2}
            fontSize={FONT}
            fill={color.ink3}
            textAnchor="end"
          >
            15:00
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

function MinuteVolume({
  series,
  X,
  top,
  h,
  w,
}: {
  series: MinuteSeries;
  X: (x: number) => number;
  top: number;
  h: number;
  w: number;
}) {
  const vmax = Math.max(1, ...series.volume);
  const bw = Math.max(0.6, (w - 8) / (MINUTES + 1) - 0.3);
  let up = '';
  let down = '';
  series.volume.forEach((v, i) => {
    const hh = (h * v) / vmax;
    const r = `M${(X(series.x[i]) - bw / 2).toFixed(1)} ${(
      top +
      h -
      hh
    ).toFixed(1)}h${bw.toFixed(1)}v${hh.toFixed(1)}h${(-bw).toFixed(1)}Z`;
    if (series.up[i]) {
      up += r;
    } else {
      down += r;
    }
  });
  return (
    <>
      <Path d={up} fill={color.up} />
      <Path d={down} fill={color.down} />
    </>
  );
}

const N_BARS = 60;

export function KlineChart({
  bars,
  decimals,
  emptyText,
}: {
  bars: KBar[] | null;
  decimals: number;
  emptyText: string;
}) {
  const [w, onLayout] = useWidth();
  const ph = H * 0.68;
  const vTop = ph + 16;
  const vh = H - vTop - 14;
  if (!bars || bars.length === 0 || w === 0) {
    return (
      <View style={styles.box} onLayout={onLayout}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            <SvgText
              x={w / 2}
              y={ph / 2}
              fontSize={12}
              fill={color.ink3}
              textAnchor="middle"
            >
              {emptyText}
            </SvgText>
          </Svg>
        ) : null}
      </View>
    );
  }
  const v = klineView(bars, N_BARS);
  const cw = (w - 8) / N_BARS;
  const X = (i: number) => 4 + cw * i + cw / 2;
  const Y = (p: number) => 14 + ((ph - 18) * (v.hi - p)) / (v.hi - v.lo || 1);
  const bw = Math.max(1, cw * 0.7);
  const last = <T,>(a: (T | null)[]) => a[a.length - 1];
  const maText = (label: string, val: number | null) =>
    label + ' ' + (val == null ? '--' : fx(val, decimals));
  return (
    <View style={styles.box} onLayout={onLayout}>
      <Svg width={w} height={H}>
        {[0, 1, 2, 3].map(k => (
          <Line
            key={k}
            x1={0}
            x2={w}
            y1={14 + ((ph - 18) * k) / 3}
            y2={14 + ((ph - 18) * k) / 3}
            stroke={color.grid}
          />
        ))}
        <SvgText x={4} y={10} fontSize={FONT} fill={color.ma5}>
          {maText('MA5', last(v.ma5))}
        </SvgText>
        <SvgText x={w * 0.3} y={10} fontSize={FONT} fill={color.ma10}>
          {maText('MA10', last(v.ma10))}
        </SvgText>
        <SvgText x={w * 0.6} y={10} fontSize={FONT} fill={color.ma20}>
          {maText('MA20', last(v.ma20))}
        </SvgText>
        {v.bars.map((b, i) => {
          const up = b.close >= b.open;
          const c = up ? color.up : color.down;
          const y1 = Y(Math.max(b.open, b.close));
          const y2 = Y(Math.min(b.open, b.close));
          return (
            <Path
              key={b.date}
              d={
                `M${X(i)} ${Y(b.high)}V${y1}M${X(i)} ${y2}V${Y(b.low)}` +
                `M${X(i) - bw / 2} ${y1}h${bw}v${Math.max(1, y2 - y1)}h${-bw}Z`
              }
              stroke={c}
              strokeWidth={1}
              fill={up ? color.card : c}
            />
          );
        })}
        {v.bars.map((b, i) => {
          const up = b.close >= b.open;
          const vv = (vh * b.volume) / v.vmax;
          return (
            <Rect
              key={'v' + b.date}
              x={X(i) - bw / 2}
              y={vTop + vh - vv}
              width={bw}
              height={vv}
              fill={up ? color.up : color.down}
              opacity={up ? 0.55 : 0.8}
            />
          );
        })}
        {(
          [
            [v.ma5, color.ma5],
            [v.ma10, color.ma10],
            [v.ma20, color.ma20],
          ] as const
        ).map(([line, c]) => (
          <Path
            key={c + line.length}
            d={linePath(
              v.bars.map((_, i) => X(i)),
              line.map(p => (p == null ? null : Y(p))),
            )}
            stroke={c}
            strokeWidth={1}
            fill="none"
          />
        ))}
        <SvgText
          x={w - 4}
          y={24}
          fontSize={FONT}
          fill={color.ink3}
          textAnchor="end"
        >
          {fx(v.hi, decimals)}
        </SvgText>
        <SvgText
          x={w - 4}
          y={ph - 2}
          fontSize={FONT}
          fill={color.ink3}
          textAnchor="end"
        >
          {fx(v.lo, decimals)}
        </SvgText>
        <SvgText x={4} y={vTop - 3} fontSize={FONT} fill={color.ink3}>
          成交量
        </SvgText>
        <SvgText x={4} y={H - 2} fontSize={FONT} fill={color.ink3}>
          {barLabel(v.bars[0].date)}
        </SvgText>
        <SvgText
          x={w - 4}
          y={H - 2}
          fontSize={FONT}
          fill={color.ink3}
          textAnchor="end"
        >
          {barLabel(v.bars[v.bars.length - 1].date)}
        </SvgText>
      </Svg>
    </View>
  );
}

/** 分钟 K 的日期带时间（YYYY-MM-DD HH:MM），图上去掉年份。 */
const barLabel = (d: string) => (d.length > 10 ? d.slice(5) : d);

const styles = StyleSheet.create({
  box: { height: H, backgroundColor: color.card },
});

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  width?: number;
}

/** 几条百分比折线（账户分析的累计收益）：0 轴、最高最低刻度、起止日期、图例。 */
export function LinesChart({
  series,
  labels,
  height = 180,
}: {
  series: LineSeries[];
  labels: [string, string];
  height?: number;
}) {
  const [w, onLayout] = useWidth();
  const all = series.flatMap(sr => sr.values).concat(0);
  const top = Math.max(...all);
  const bot = Math.min(...all);
  const n = Math.max(1, ...series.map(sr => sr.values.length));
  const ph = height - 30;
  const X = (i: number) => 4 + ((w - 8) * i) / Math.max(1, n - 1);
  const Y = (v: number) => 8 + ((ph - 16) * (top - v)) / (top - bot || 1);
  return (
    <View style={{ height }} onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Line
            x1={0}
            x2={w}
            y1={Y(0)}
            y2={Y(0)}
            stroke={color.baseLine}
            strokeDasharray="3 3"
          />
          {series.map(sr => (
            <Path
              key={sr.name}
              d={linePath(
                sr.values.map((_, i) => X(i)),
                sr.values.map(Y),
              )}
              stroke={sr.color}
              strokeWidth={sr.width ?? 1.5}
              fill="none"
            />
          ))}
          <SvgText x={4} y={12} fontSize={FONT} fill={color.ink3}>
            {top.toFixed(1) + '%'}
          </SvgText>
          <SvgText x={4} y={ph - 4} fontSize={FONT} fill={color.ink3}>
            {bot.toFixed(1) + '%'}
          </SvgText>
          <SvgText x={4} y={ph + 12} fontSize={FONT} fill={color.ink3}>
            {labels[0]}
          </SvgText>
          <SvgText
            x={w - 4}
            y={ph + 12}
            fontSize={FONT}
            fill={color.ink3}
            textAnchor="end"
          >
            {labels[1]}
          </SvgText>
          {series.map((sr, i) => (
            <SvgText
              key={sr.name}
              x={4 + i * 92}
              y={height - 2}
              fontSize={FONT + 1}
              fill={sr.color}
            >
              {'— ' + sr.name}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
