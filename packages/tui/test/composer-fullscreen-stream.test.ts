import { beforeAll, describe, expect, it } from "bun:test";
import type { Component } from "@oh-my-pi/pi-tui";
import { TranscriptContainer, type TranscriptStableRow } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import { COMPOSER_DEFAULTS, Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { VirtualTerminal } from "./virtual-terminal";

/**
 * Streaming append-only block: publishes a monotonically extending stable prefix, the
 * same contract the transcript's tool cards use when output streams in.
 */
class StreamingBlock implements Component {
	readonly transcriptBlockMode = "appendOnly" as const;
	readonly #all: string[];
	#stable: TranscriptStableRow[] = [];
	#stableRows: string[] = [];

	constructor(total: number) {
		this.#all = Array.from({ length: total }, (_, index) => `line ${index}`);
	}

	publish(count: number): void {
		this.#stable = this.#all.slice(0, count).map(row => ({ key: row }));
		this.#stableRows = this.#all.slice(0, count);
	}

	isTranscriptBlockFinalized(): boolean {
		return this.#stable.length === this.#all.length;
	}

	getTranscriptStableRows(): readonly TranscriptStableRow[] {
		return this.#stable;
	}

	renderTranscriptStableRows(count: number): readonly string[] {
		return this.#stableRows.slice(0, Math.min(count, this.#stableRows.length));
	}

	render(): readonly string[] {
		return this.#all;
	}
}

describe("fullscreen scroll over a streaming block", () => {
	beforeAll(() => {
		initTheme();
	});

	it("keeps published stable rows scrollable after the engine acks them", () => {
		const term = new VirtualTerminal(60, 14);
		const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
		composer.start();
		try {
			const transcript = new TranscriptContainer();
			const block = new StreamingBlock(100);
			transcript.addChild(block);
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);

			// Stream 20 rows at a time, draining retirement after each publish the way
			// the engine does (render -> the provider offers a batch -> ack it).
			for (let published = 20; published <= 100; published += 20) {
				block.publish(published);
				for (let frame = 0; frame < 8; frame++) {
					const plan = composer.renderFrame({ columns: 60, rows: 14 });
					if (plan.history === undefined) break;
					composer.acknowledgeHistory(plan.history.id);
				}
			}

			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);
			const scrolled = composer.renderFrame({ columns: 60, rows: 14 });
			const text = scrolled.viewport.map(row => Bun.stripANSI(row)).join("\n");
			expect(text).toContain("line 0");
		} finally {
			composer.stop();
		}
	});
});
