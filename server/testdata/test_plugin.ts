export function up(s: string) {
  return s.toUpperCase();
}

export async function wait(n: number) {
  await new Promise<void>((res): number =>
    setTimeout((): void => {
      res();
    }, n)
  );
  return n;
}
