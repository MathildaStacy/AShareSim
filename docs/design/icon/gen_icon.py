# 生成 AShareSim 图标：深色底 + 三根上涨的 K 线（红涨绿跌）。
# 在本目录运行，输出 icon.svg、icon_round.svg、ic_launcher_foreground.xml（复制到 android/app/src/main/res/drawable/）。
BG1, BG2 = '#1F2329', '#2E3744'
RED, GREEN = '#E5322D', '#0E9F5B'
# (中心 x, 影线上, 实体上, 实体下, 影线下, 颜色)，1024 画布
C = [(340, 470, 530, 700, 750, GREEN), (512, 370, 420, 610, 660, RED), (684, 250, 300, 500, 560, RED)]
W, WICK = 112, 22
def svg(shape):
    body = []
    for x, wt, bt, bb, wb, c in C:
        body.append(f'<rect x="{x-WICK/2}" y="{wt}" width="{WICK}" height="{wb-wt}" rx="{WICK/2}" fill="{c}"/>')
        body.append(f'<rect x="{x-W/2}" y="{bt}" width="{W}" height="{bb-bt}" rx="18" fill="{c}"/>')
    clip = '<rect width="1024" height="1024" rx="224"/>' if shape == 'square' else '<circle cx="512" cy="512" r="512"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG2}"/><stop offset="1" stop-color="{BG1}"/></linearGradient>
<clipPath id="c">{clip}</clipPath></defs>
<g clip-path="url(#c)"><rect width="1024" height="1024" fill="url(#g)"/>
<path d="M210 800 H814" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="10" stroke-linecap="round"/>
{''.join(body)}</g></svg>'''
open('icon.svg','w').write(svg('square'))
open('icon_round.svg','w').write(svg('round'))
# 自适应图标前景（108dp 视口，安全区半径 33dp）：K 线放大到约 50dp 高，底线会被圆形遮罩切掉，不画
s = 0.1; cx, cy = 512, 500
T = lambda x, y: (54 + (x-cx)*s, 54 + (y-cy)*s)
def rr(x0, y0, x1, y1, r):
    (a, b), (c, d) = T(x0, y0), T(x1, y1); r = r*s
    return (f'M{a+r:.2f},{b:.2f} H{c-r:.2f} A{r:.2f},{r:.2f} 0 0 1 {c:.2f},{b+r:.2f} V{d-r:.2f} '
            f'A{r:.2f},{r:.2f} 0 0 1 {c-r:.2f},{d:.2f} H{a+r:.2f} A{r:.2f},{r:.2f} 0 0 1 {a:.2f},{d-r:.2f} '
            f'V{b+r:.2f} A{r:.2f},{r:.2f} 0 0 1 {a+r:.2f},{b:.2f} Z')
paths = []
for x, wt, bt, bb, wb, col in C:
    paths.append(f'<path android:fillColor="{col}" android:pathData="{rr(x-WICK/2, wt, x+WICK/2, wb, WICK/2)}"/>')
    paths.append(f'<path android:fillColor="{col}" android:pathData="{rr(x-W/2, bt, x+W/2, bb, 18)}"/>')
open('ic_launcher_foreground.xml','w').write('''<?xml version="1.0" encoding="utf-8"?>
<!-- AShareSim 图标前景：三根上涨的 K 线（红涨绿跌），源文件 docs/design/icon.svg -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    ''' + '\n    '.join(paths) + '\n</vector>\n')
