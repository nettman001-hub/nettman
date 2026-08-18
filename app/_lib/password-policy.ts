const SPECIAL_CHARACTER = /[^A-Za-z0-9\s]/;

export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return "비밀번호를 8자 이상 입력해 주세요.";
  if (!/[0-9]/.test(password)) return "비밀번호에 숫자를 1개 이상 포함해 주세요.";
  if (!SPECIAL_CHARACTER.test(password)) {
    return "비밀번호에 특수문자를 1개 이상 포함해 주세요.";
  }
  if (/\s/.test(password)) return "비밀번호에는 공백을 사용할 수 없습니다.";
  return null;
}
