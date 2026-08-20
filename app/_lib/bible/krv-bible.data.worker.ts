// Worker(vinext/Sites) 빌드 전용 스텁 — 4.5MB 데이터 모듈이 rolldown 번들을
// 정지시키므로 보조 배포에서는 빈 성경 데이터로 대체한다. bible-text.ts의
// 모든 조회는 데이터 부재 시 null/[]로 우아하게 강등된다. (vite.config.ts alias)
export const krvBibleJson: string = '{"books":[]}';
