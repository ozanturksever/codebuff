// US-003: Create a combined message utility
import { greet } from "./greeting";
import { farewell } from "./farewell";

export function sessionMessage(name: string): string {
  return `${greet(name)} ${farewell(name)}`;
}
