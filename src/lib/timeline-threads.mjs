// All coordinates are measured inside the list, never relative to the viewport.
// Scrolling moves cards and their cords together without rebuilding either.
export function dateThreadPath(anchor, pin, mobile = false) {
  return mobile
    ? 'M ' + anchor.x + ' ' + anchor.y + ' C ' + anchor.x + ' ' + (anchor.y + 28) + ', ' + (pin.x - 20) + ' ' + pin.y + ', ' + pin.x + ' ' + pin.y
    : 'M ' + anchor.x + ' ' + anchor.y + ' C ' + (anchor.x + 12) + ' ' + (anchor.y + 25) + ', ' + (pin.x - 14) + ' ' + (pin.y - 22) + ', ' + pin.x + ' ' + pin.y;
}

export function eventThreadPath(first, second, mobile = false) {
  const from = mobile ? { x: first.left, y: first.bottom - 24 } : { x: first.right, y: first.top + 68 };
  const to = mobile ? { x: second.left, y: second.top + 30 } : { x: second.left, y: second.top + 68 };
  const d = mobile
    ? 'M ' + from.x + ' ' + from.y + ' C ' + (Math.min(from.x, to.x) - 24) + ' ' + (from.y + 30) + ', ' + (Math.min(from.x, to.x) - 24) + ' ' + (to.y - 30) + ', ' + to.x + ' ' + to.y
    : 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + (to.x - from.x) * .32) + ' ' + (from.y + 24) + ', ' + (to.x - (to.x - from.x) * .32) + ' ' + (to.y + 24) + ', ' + to.x + ' ' + to.y;
  return { from, to, d };
}
