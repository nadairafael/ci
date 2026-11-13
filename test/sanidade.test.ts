import { expect, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("roda", () => Effect.succeed(1).pipe(Effect.map((n) => expect(n).toBe(1))))
