# 가구 데이터 구조 (`data/items.json`)

실제 상품이 아니라 **대표 유형**을 모델링한다. 가격·치수는 시중 제품을 참고한 추정 대표값이다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID |
| `name` | string | 표시 이름 |
| `category` | string | 수납, 조명, 침구, 러그, 책상, 의자, 소품 등 |
| `price` | number | 대표 가격(원) |
| `size` | {w, d, h} | 가로·세로·높이(cm) |
| `styles` | string[] | 어울리는 스타일 (미니멀, 우드, 모던, 따뜻한 등) |
| `noDrill` | boolean | 못·타공 없이 설치 가능 여부 (원상복구 고려) |
| `priority` | 1~3 | 필요도. 1이 가장 먼저 채울 항목 |
| `alternativeTo` | string | 예산 초과 시 이 항목의 저가 대체품이 가리키는 id |
| `image` | string | 사진 위 배치용 투명 PNG 경로 (`assets/furniture/...`) |
