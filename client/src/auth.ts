const KEY = "nihongo:passcode";

export const auth = {
  get(): string | null {
    return localStorage.getItem(KEY);
  },
  set(passcode: string): void {
    localStorage.setItem(KEY, passcode);
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
