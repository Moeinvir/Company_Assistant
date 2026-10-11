import { FA_PART1 } from "./fa.part1";
import { FA_PART2 } from "./fa.part2";
import { FA_PART3, FA_PART4, FA_PART5 } from "./fa.part3";

/** English UI string → Persian. Later entries win on duplicate keys. */
export const FA: ReadonlyMap<string, string> = new Map<string, string>([
  ...FA_PART1,
  ...FA_PART2,
  ...FA_PART3,
  ...FA_PART4,
  ...FA_PART5,
]);
