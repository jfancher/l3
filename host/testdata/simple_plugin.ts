export function fn(arg: { name: string }): { message: string } {
  return { message: `name: ${arg.name}` };
}
