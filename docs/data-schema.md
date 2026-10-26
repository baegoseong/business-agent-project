# 가구 데이터 구조 (`data/items.json`)

상품 정보는 공개 데이터셋 **Amazon Berkeley Objects (ABO, CC BY 4.0, Amazon.com)** 에서 가져왔다.
상품 이미지는 흰 배경을 제거한 투명 WebP(`assets/products/`)이고, 치수는 ABO 메타데이터를 사진 비율에 맞춰 보정한 값이다.
**ABO에는 가격이 없어서 가격은 카테고리 기준가와 크기·키워드로 추정한 참고 값**이다(`priceBasis: "estimate"`).

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | ABO 상품 ID (이미지 파일명과 동일) |
| `name` | string | 화면에 쓰는 짧은 한글 이름 |
| `brand` | string | 브랜드 (한글 표기, 없을 수 있음) |
| `fullName` | string | 번역한 전체 상품명 |
| `category` | string | 22개: 의자, 소파, 스툴, 벤치, 테이블, 책상, 침대 프레임, 침구, 선반, 수납장, 수납 박스, 바구니, 신발 선반, 조명, 시계, 거울, 벽장식, 쿠션, 꽃병, 화분, 소품, 러그 |
| `price` | number | 추정 가격(원) |
| `priceBasis` | `"estimate"` | 가격이 실제 판매가가 아님을 나타낸다 |
| `size` | {w, d, h} | 가로·깊이·높이(cm). 납작한 벽 상품은 (가로, 두께, 높이) |
| `view` | `front` \| `top` | 사진 시점. `top`은 러그처럼 위에서 찍은 사진 |
| `aspect` | number | 이미지의 세로/가로 비율. 사진 위에 그릴 때 이 비율을 쓴다 |
| `styles` | string[] | 미니멀, 모던, 우드, 따뜻한 중 1~3개 (이름의 키워드로 자동 분류) |
| `mount` | `wall` \| `hang` \| `place` | 설치 방식. `wall`=벽에 걸거나 붙임(못·타공 필요 가능), `hang`=옷장 봉 등에 걸어 씀(벽에 못 불필요), `place`=바닥·탁자 위에 놓음 |
| `noDrill` | boolean | `mount`에서 계산한 값. `wall`일 때만 `false` |
| `priority` | 1~3 | 필요도. 1이 가장 먼저 채울 항목 |
| `alternativeTo` | string (선택) | 같은 카테고리에서 **더 비싼** 상품의 id. 예산 초과 시 저가 대체품이 된다 |
| `image` | string | 투명 WebP 경로 |
| `source` | object | `{ name, license, itemId }` 출처 표시용 |

## 만드는 방법 (`tools/`)
1. `abo_candidates.py`: ABO 메타데이터에서 자취방에 맞는 후보를 걸러 썸네일을 받는다.
2. `abo_images.py`: 후보의 원본 이미지를 개별로 받는다.
3. `abo_cutout.py`: 흰 배경(가장자리와 가구 안쪽에 갇힌 부분)을 지워 투명 WebP로 만들고 실패를 표시한다.
4. `mount_rules.py`: 이름과 카테고리로 설치 방식(`mount`)을 정한다. 실행하면 `data/items.json`에 반영한다.
5. `abo_build_items.py`: 가격·스타일·필요도·못 필요 여부·저가 대체 관계를 붙여 `data/items.json`을 만든다.

원본 데이터와 중간 결과는 `data/raw/`(git 제외)에 있다.

## 검증
```
python3 tools/validate_data.py
```
필수 필드, 값 범위, id 중복, 대체품이 같은 카테고리에서 더 저렴한지, 가격이 추정값 표시인지, 이미지 파일 존재와 비율, 모든 스타일에 항목이 있는지 검사한다.
