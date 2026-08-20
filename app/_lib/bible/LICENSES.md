# 성경 데이터 출처 및 라이선스

이 디렉터리의 데이터 파일(`krv-bible.json`, `cross-references.json`)의 출처와 라이선스 기록.
검증: `node scripts/verify-bible-data.mjs`

## krv-bible.json — 개역한글판 (Korean Revised Version, 1961)

- **본문**: 개역한글판 성경전서 (1961, 대한성서공회 발행). 대한민국 저작권법상 발행 후 보호기간이 만료되어 퍼블릭 도메인으로 통용된다.
- **데이터 소스**: [laisiangtho/bible](https://github.com/laisiangtho/bible) 저장소의 `json/88.json`
  (identify=88, shortname=KRV, year=1961, publisher="Korean Bible Society")
  - 다운로드 URL: <https://raw.githubusercontent.com/laisiangtho/bible/master/json/88.json>
  - 저장소 라이선스: MIT License (Copyright (c) 2024 Lai Siangtho)
  - 취득일: 2026-08-20
- **가공 내용**: 책명·약어를 한국 개신교 표준 명칭으로 통일(예: "요한2서" → "요한이서"), 절 텍스트 NFC 정규화·제어문자 제거·공백 정리, `{ books: [{ name, abbr, chapters: [[절...], ...] }] }` 형태로 재구성. 66권 31,103절(개역한글 절 구분 기준: 아가 118절, 요한삼서 15절, 고린도후서 256절).

## cross-references.json — 성경 교차참조

- **출처**: OpenBible.info Cross References (Treasury of Scripture Knowledge 기반 정제본)
  - 프로젝트 페이지: <https://www.openbible.info/labs/cross-references/>
  - 다운로드 URL: <https://a.openbible.info/data/cross-references.zip> (데이터 스탬프: 2026-08-17)
- **라이선스**: Creative Commons Attribution (CC-BY). 저작자 표시:
  "Cross references from OpenBible.info, https://www.openbible.info/labs/cross-references/ (CC-BY)"
  이 데이터를 사용자에게 노출하는 화면·문서에는 위 표기를 포함해야 한다.
- **가공 내용**: votes ≥ 1 필터링, from-verse당 votes 상위 3건 유지, 개역한글판에 존재하지 않는 절을 가리키는 참조 제거(65건), 책 경계를 넘는 범위 참조는 시작 절만 유지(18건). 키는 `"책인덱스.장.절"`(0-기반 정경 순서), 값은 `[책인덱스, 시작장, 시작절, 끝장, 끝절]` 배열(단일 절은 끝장·끝절 0). 총 29,318 from-verse, 84,497 참조.
