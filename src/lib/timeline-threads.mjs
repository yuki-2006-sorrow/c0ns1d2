// Layout all entries before viewport culling so lanes do not jump while panning.
export function layoutThreadCards(events, { xFor, axisY, width, height, gapX = 28, gapY = 44, maxShift = width * .65 }) {
  const ends = [];
  return events.map(event => {
    const anchorX = xFor(event);
    const desiredLeft = anchorX - width / 2;
    let lane = 0;
    while (ends[lane] != null && ends[lane] - desiredLeft > maxShift) ++lane;
    const left = Math.max(desiredLeft, ends[lane] ?? desiredLeft);
    ends[lane] = left + width + gapX;
    const top = axisY + 84 + lane * (height + gapY);
    return { event, anchorX, left, top, lane, width, height };
  });
}

export function dateThreadPath(x, axisY, endX, endY, bend = 12) {
  const distance = endY - axisY;
  return `M ${x} ${axisY} C ${x + bend} ${axisY + distance * .34}, ${endX - bend} ${endY - distance * .24}, ${endX} ${endY}`;
}

// Different rows are connected outside the cards, rather than through the text.
export function eventThreadPath(first, second, { leftBound = -Infinity, rightBound = Infinity } = {}) {
  const firstRight = first.left + first.width + 3;
  const nextLeft = second.left - 3;
  const y1 = first.top + 48;
  const y2 = second.top + 48;
  if (nextLeft >= firstRight) {
    const gap = nextLeft - firstRight;
    const sag = Math.min(48, Math.max(18, gap * .12));
    return { d: `M ${firstRight} ${y1} C ${firstRight + gap * .35} ${y1 + sag}, ${nextLeft - gap * .35} ${y2 + sag}, ${nextLeft} ${y2}`, from: [firstRight, y1], to: [nextLeft, y2] };
  }
  const nextRight = second.left + second.width + 3;
  const rail = Math.max(firstRight, nextRight) + 28;
  const leftRail = Math.min(first.left, second.left) - 31;
  if (rail > rightBound && leftRail >= leftBound) {
    const firstLeft = first.left - 3, secondLeft = second.left - 3;
    return { d: `M ${firstLeft} ${y1} C ${leftRail} ${y1}, ${leftRail} ${y2}, ${secondLeft} ${y2}`, from: [firstLeft, y1], to: [secondLeft, y2] };
  }
  return { d: `M ${firstRight} ${y1} C ${rail} ${y1}, ${rail} ${y2}, ${nextRight} ${y2}`, from: [firstRight, y1], to: [nextRight, y2] };
}
