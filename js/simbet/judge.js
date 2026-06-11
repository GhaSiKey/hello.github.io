/**
 * judge.js — 投注判定（纯逻辑，赛后用；与 settle_results.py 规则一致）
 *
 * judge(type, pick, result) -> true(中) | false(不中) | null(无法结算)
 *   result = { full:{h,a}, half:{h,a}|null }
 */
function judge(type, pick, result) {
  if (!result || !result.full) return null;          // 没赛果
  const { h, a } = result.full;

  switch (type) {
    case 'had': {                                     // 胜平负
      const r = h > a ? 'h' : (h < a ? 'a' : 'd');
      return pick === r;
    }
    case 'hhad': {                                    // 让球胜平负
      const H = h + pick.goalLine;
      const r = H > a ? 'h' : (H < a ? 'a' : 'd');
      return pick.side === r;
    }
    case 'crs':                                       // 比分精确匹配
      return pick.h === h && pick.a === a;
    case 'ttg': {                                     // 总进球（7 表示 7+）
      const g = Math.min(h + a, 7);
      return pick === g;
    }
    case 'hafu': {                                    // 半全场：需半场比分
      if (!result.half) return null;                  // 拿不到半场 → 无法结算
      const hf = result.half;
      const half = hf.h > hf.a ? 'h' : (hf.h < hf.a ? 'a' : 'd');
      const full = h > a ? 'h' : (h < a ? 'a' : 'd');
      return pick.half === half && pick.full === full;
    }
    default:
      return null;
  }
}

/** 单注派彩：命中=potential，不中=0，无法结算=null。 */
function betPayout(bet, result) {
  const hit = judge(bet.type, bet.pick, result);
  if (hit === null) return { hit: null, payout: null };
  return { hit, payout: hit ? bet.potential : 0 };
}
