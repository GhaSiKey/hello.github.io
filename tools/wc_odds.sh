#!/usr/bin/env bash
#
# wc_odds.sh — 中国体彩竞彩足球赔率抓取工具
#
# 原理：体彩官网赔率页是 Vue 动态渲染，HTML 内无数据，真实数据走后端
#       webapi.sporttery.cn 的 gateway 接口。本脚本顺着前端 JS 逆向出的
#       两个接口直接取 JSON：
#         - getMatchHeadV1  对阵信息（队名/赛事/时间/场次）
#         - getFixedBonusV1 固定奖金（胜平负/让球/比分/总进球/半全场）
#       JSON 解析交给同目录的 _wc_parse.py（避免 shell 内联 Python 的引号地狱）。
#
# 用法：
#   ./wc_odds.sh <mid>               # 单场全部玩法赔率
#   ./wc_odds.sh <起始mid> <结束mid>  # 区间扫描，只列对阵 + 胜平负摘要
#   ./wc_odds.sh                     # 不传参 → 用默认区间(见 DEFAULT_*)演示
#
# 示例：
#   ./wc_odds.sh 2040163             # 韩国 vs 捷克 全部赔率
#   ./wc_odds.sh 2040162 2040176     # 2026 世界杯首轮一览
#
# 注意：mid 随赛事推进而变化，不要写死在调用方；通过参数传入。
# 依赖：bash / curl / python3
set -euo pipefail

# ---- 接口固有常量（从体彩前端 JS 逆向，非业务硬编码）----
readonly API_BASE="https://webapi.sporttery.cn/gateway/uniform/football"
readonly CLIENT_CODE="3001"          # commonV1.js 中的 comClientCode
readonly UA="Mozilla/5.0"
readonly REFERER="https://www.sporttery.cn/"

# 解析脚本与本脚本同目录
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PARSER="$SCRIPT_DIR/_wc_parse.py"

# ---- 不传参时的默认演示区间（仅为示例，逻辑不依赖它）----
readonly DEFAULT_START="2040162"
readonly DEFAULT_END="2040176"

# 拉取单个接口的原始响应（失败返回空对象）
fetch() {
  curl -s -m 12 "$1" -A "$UA" -H "Referer: $REFERER" 2>/dev/null || echo '{}'
}

# 拉一场的两个接口，用 @@@ 拼接后交给解析器
parse_one() {
  local mid="$1" mode="$2" head bonus
  head="$(fetch "$API_BASE/getMatchHeadV1.qry?source=web&sportteryMatchId=$mid")"
  bonus="$(fetch "$API_BASE/getFixedBonusV1.qry?clientCode=$CLIENT_CODE&matchId=$mid")"
  python3 "$PARSER" "$mode" "$mid" <<< "$head@@@$bonus"
}

# 区间扫描：每行一场，对阵 + 胜平负摘要
scan_range() {
  local start="$1" end="$2" mid
  printf "%-9s %-8s %-16s %-4s %-22s %s\n" "MID" "场次" "时间(北京)" "组" "对阵" "胜/平/负"
  printf '%.0s-' {1..96}; echo
  mid="$start"
  while [ "$mid" -le "$end" ]; do
    parse_one "$mid" scan
    mid=$((mid + 1))
    sleep 0.3
  done
}

# ---- 入口：按参数个数分发 ----
main() {
  for dep in curl python3; do
    command -v "$dep" >/dev/null 2>&1 || { echo "缺少依赖: $dep" >&2; exit 1; }
  done
  [ -f "$PARSER" ] || { echo "找不到解析器: $PARSER" >&2; exit 1; }

  case "$#" in
    0)
      echo "未传参，演示默认区间 $DEFAULT_START~$DEFAULT_END（实际使用请传 mid）"
      echo
      scan_range "$DEFAULT_START" "$DEFAULT_END"
      ;;
    1)
      parse_one "$1" match
      ;;
    2)
      [ "$1" -le "$2" ] 2>/dev/null || { echo "起始 mid 需 <= 结束 mid" >&2; exit 1; }
      scan_range "$1" "$2"
      ;;
    *)
      echo "用法: $0 [<mid> | <起始mid> <结束mid>]" >&2
      exit 1
      ;;
  esac
}

main "$@"
