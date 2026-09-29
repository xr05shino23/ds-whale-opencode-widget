// 素材缺失兜底：发布版按上游 PROVENANCE 约定「不随包分发 assets/ 美术素材」，
// 用户没先跑 scripts/fetch-assets.mjs 时，这些占位物保证挂件仍然「有形象」而不是空白 + 404。
//
// - WHALE_SVG：角色占位（走 image.png / rua.gif 路由，Content-Type 用 image/svg+xml 也能被 <img> 正常渲染）
// - TRAY_ICON_DATA_URL：托盘兜底图标（16/32px PNG，内嵌 base64，无运行时依赖）

export const WHALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="wb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a86dd"/>
      <stop offset="1" stop-color="#2b57a8"/>
    </linearGradient>
  </defs>
  <path d="M392 186c46-40 76-46 96-40-14 34-42 62-84 78z" fill="#3a6fc4"/>
  <path d="M150 132c8-26 22-42 40-48-4 22-14 40-30 54z" fill="#9cc8f5"/>
  <ellipse cx="244" cy="300" rx="186" ry="112" fill="url(#wb)"/>
  <ellipse cx="236" cy="336" rx="140" ry="66" fill="#dceafa" opacity=".92"/>
  <circle cx="330" cy="262" r="13" fill="#12203c"/>
  <circle cx="335" cy="257" r="4" fill="#ffffff" opacity=".85"/>
  <path d="M120 306c34 16 78 20 118 12" stroke="#2b57a8" stroke-width="8" fill="none" stroke-linecap="round" opacity=".55"/>
</svg>`

export const PLACEHOLDER_IMAGE = Object.freeze({
  type: 'image/svg+xml; charset=utf-8',
  body: WHALE_SVG,
})

// 32×32 蓝色小鲸鱼，程序生成后内嵌（见 tools/gen-tray-icon.mjs 的生成逻辑）
export const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAfklEQVR42mNgGAVEgmknvv6H4VEHjDqAkFqbihv/CeEBdQDNQ2tALcfnAKpbQooDaBak2CyimuWkWEz1YB/ylpPtCEosE5GzAWOKHDGkHUBxNNDCcrIcce3FL4oxxVEwch1ALUdQrTAaEMux5QqaBzs1a0O6NTpGe0ujYFgAAFqnv9YtP6RnAAAAAElFTkSuQmCC'
