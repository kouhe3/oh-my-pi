import { describe, expect, it } from "bun:test";
import type { Component } from "@oh-my-pi/pi-tui";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";

/** Finalized fixed-row block: two rows, no wrapping, so window row math is exact. */
class Rows implements Component {
	constructor(private readonly rows: readonly string[]) {}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	render(_width: number): readonly string[] {
		return this.rows;
	}
}

/** Width-sensitive block, to prove a ledger rebuild actually re-renders. */
class PaddedRows implements Component {
	constructor(private readonly label: string) {}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	render(width: number): readonly string[] {
		return [`${this.label}${".".repeat(Math.max(0, width - this.label.length))}`];
	}
}

const FRAME = { tick: 0, now: 0 };

function retainedContainer(blockCount: number): TranscriptContainer {
	const container = new TranscriptContainer();
	for (let index = 0; index < blockCount; index++) {
		container.addChild(new Rows([`${index}-a`, `${index}-b`]));
	}
	container.setRetainedLedger(true);
	// The ledger is built lazily at the rendered width, so this primes it.
	container.renderWindow(40, 6, 0, FRAME);
	const batch = container.peekFinalizedBatch(40, 0);
	if (batch === undefined) throw new Error("expected a retirement batch");
	container.acknowledgeFinalizedBatch(batch.id);
	return container;
}

describe("retained transcript window", () => {
	it("addresses retired rows by scroll offset and clamps at the top", () => {
		const container = retainedContainer(6);

		// Tail: the newest six rows of six 2-row blocks with their blank separators.
		expect(container.renderWindow(40, 6, 0, FRAME)).toEqual(["4-a", "4-b", "", "5-a", "5-b", ""]);
		expect(container.lastWindowHasMoreAbove()).toBe(true);

		// Scrolled up one window.
		expect(container.renderWindow(40, 6, 6, FRAME)).toEqual(["2-a", "2-b", "", "3-a", "3-b", ""]);
		expect(container.lastWindowOffset()).toBe(6);

		// Over-scroll clamps at the top instead of rendering an empty window.
		expect(container.renderWindow(40, 6, 999, FRAME)).toEqual(["0-a", "0-b", "", "1-a", "1-b", ""]);
		expect(container.lastWindowOffset()).toBe(12);
		expect(container.lastWindowHasMoreAbove()).toBe(false);
	});

	it("publishes click spans for the windowed rows", () => {
		const container = retainedContainer(6);
		const scrolled = container.renderWindow(40, 6, 6, FRAME);
		const owners = container.getLastViewportSpans();

		// Two visible blocks, each covering its two rows, with the separator unowned.
		expect(owners.map(span => [span.start, span.end])).toEqual([
			[0, 2],
			[3, 5],
		]);
		expect(scrolled.slice(0, 2)).toEqual(["2-a", "2-b"]);
		expect(owners[0]!.component).not.toBe(owners[1]!.component);
	});

	it("re-renders the retained stream at a new width", () => {
		const container = new TranscriptContainer();
		container.addChild(new PaddedRows("wide"));
		container.setRetainedLedger(true);
		container.renderWindow(20, 4, 0, FRAME);
		const batch = container.peekFinalizedBatch(20, 0);
		if (batch === undefined) throw new Error("expected a retirement batch");
		container.acknowledgeFinalizedBatch(batch.id);
		expect(container.renderWindow(20, 4, 0, FRAME)[0]).toBe("wide................");

		// A settled width change replays the retained entry at the new width rather
		// than serving stale rows wrapped for the old one.
		expect(container.renderWindow(12, 4, 0, FRAME)[0]).toBe("wide........");
	});
});
