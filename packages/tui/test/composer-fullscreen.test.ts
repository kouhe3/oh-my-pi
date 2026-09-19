import { beforeAll, describe, expect, it } from "bun:test";
import type { Component } from "@oh-my-pi/pi-tui";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import { COMPOSER_DEFAULTS, Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { VirtualTerminal } from "./virtual-terminal";

/** Finalized fixed-row block, so retirement and the retained ledger both engage. */
class FinalBlock implements Component {
	constructor(private readonly rows: readonly string[]) {}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	render(_width: number): readonly string[] {
		return this.rows;
	}
}

class ClickableBlock extends FinalBlock {
	constructor(
		rows: readonly string[],
		private readonly ids: readonly string[],
	) {
		super(rows);
	}

	getClickFocusAgentIds(): string[] {
		return [...this.ids];
	}
}

/** Block that toggles its own presentation on a pointer click. */
class ToggleBlock implements Component {
	toggles = 0;
	constructor(private readonly rows: readonly string[]) {}

	isTranscriptBlockFinalized(): boolean {
		return true;
	}

	render(_width: number): readonly string[] {
		return this.rows;
	}

	handleTranscriptClick(): void {
		this.toggles += 1;
	}
}

function buildComposer(columns = 60, rows = 14): { composer: Composer; term: VirtualTerminal } {
	const term = new VirtualTerminal(columns, rows);
	const composer = new Composer({ terminal: term, preferences: { ...COMPOSER_DEFAULTS, quiet: true } });
	composer.start();
	return { composer, term };
}

function plainRows(viewport: readonly string[]): string[] {
	return viewport.map(row => Bun.stripANSI(row).trimEnd());
}

describe("composer fullscreen main view", () => {
	beforeAll(() => {
		initTheme();
	});

	it("fills the terminal exactly and scrolls the retained stream", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 10; index++) {
				transcript.addChild(new FinalBlock([`row ${index} a`, `row ${index} b`]));
			}
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);

			const tail = composer.renderFrame({ columns: 60, rows: 14 });
			expect(tail.viewport).toHaveLength(14);
			expect(plainRows(tail.viewport).join("\n")).toContain("row 9 a");

			composer.scrollTranscript(4);
			const scrolled = composer.renderFrame({ columns: 60, rows: 14 });
			expect(scrolled.viewport).toHaveLength(14);
			expect(composer.getTranscriptScroll().offset).toBeGreaterThan(0);
			// The hint names the position and the rows on screen moved up the stream.
			expect(plainRows(scrolled.viewport).join("\n")).toContain("rows above");
			expect(plainRows(scrolled.viewport).join("\n")).not.toContain("row 9 a");

			composer.scrollToTranscriptTail();
			// Page scrolling shares the wheel's sign convention: -1 reads older rows.
			composer.scrollTranscriptPage(-1);
			expect(composer.getTranscriptScroll().offset).toBeGreaterThan(0);
			composer.scrollTranscriptPage(1);
			expect(composer.getTranscriptScroll().offset).toBe(0);
			expect(plainRows(composer.renderFrame({ columns: 60, rows: 14 }).viewport).join("\n")).toContain("row 9 a");
		} finally {
			composer.stop();
		}
	});

	it("keeps engine-acknowledged rows scrollable", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 10; index++) {
				transcript.addChild(new FinalBlock([`row ${index} a`, `row ${index} b`]));
			}
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);

			const plan = composer.renderFrame({ columns: 60, rows: 14 });
			if (plan.history === undefined) throw new Error("expected retirement pressure on a short slot");
			// The engine acks without writing: those rows must survive in the scroll stream.
			composer.acknowledgeHistory(plan.history.id);
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);

			expect(plainRows(composer.renderFrame({ columns: 60, rows: 14 }).viewport).join("\n")).toContain("row 0 a");
		} finally {
			composer.stop();
		}
	});

	it("reaches the top of one large retired block", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			transcript.addChild(new FinalBlock(Array.from({ length: 100 }, (_, index) => `line ${index}`)));
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);

			// Drain retirement the way the engine does (render, then ack).
			for (let frame = 0; frame < 20; frame++) {
				const plan = composer.renderFrame({ columns: 60, rows: 14 });
				if (plan.history === undefined) break;
				composer.acknowledgeHistory(plan.history.id);
			}
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);
			const rows = plainRows(composer.renderFrame({ columns: 60, rows: 14 }).viewport).join("\n");
			expect(rows).toContain("line 0");
		} finally {
			composer.stop();
		}
	});

	it("keeps the retained stream reachable across a height change", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			for (let index = 0; index < 10; index++) {
				transcript.addChild(new FinalBlock([`row ${index} a`, `row ${index} b`]));
			}
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);
			for (let frame = 0; frame < 20; frame++) {
				const plan = composer.renderFrame({ columns: 60, rows: 24 });
				if (plan.history === undefined) break;
				composer.acknowledgeHistory(plan.history.id);
			}
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);
			const tall = composer.renderFrame({ columns: 60, rows: 24 });
			expect(plainRows(tall.viewport).join("\n")).toContain("row 0 a");

			// A shorter window must expose at least as much of the stream, never less.
			const short = composer.renderFrame({ columns: 60, rows: 12 });
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);
			const scrolled = composer.renderFrame({ columns: 60, rows: 12 });
			expect(short.viewport).toHaveLength(12);
			expect(plainRows(scrolled.viewport).join("\n")).toContain("row 0 a");
		} finally {
			composer.stop();
		}
	});

	it("reaches the first retained row with a long live tail behind it", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			const retired = new FinalBlock(Array.from({ length: 25 }, (_, index) => `old ${index}`));
			transcript.addChild(retired);
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);
			// Retire (and ack) everything before the live tail exists, then append the
			// tail: the window must still be able to scroll above the live rows.
			for (let frame = 0; frame < 20; frame++) {
				const plan = composer.renderFrame({ columns: 60, rows: 24 });
				if (plan.history === undefined) break;
				composer.acknowledgeHistory(plan.history.id);
			}
			for (let index = 0; index < 5; index++) {
				transcript.addChild(new FinalBlock([`new ${index} a`, `new ${index} b`, `new ${index} c`]));
			}
			composer.renderFrame({ columns: 60, rows: 24 });

			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);
			const top = plainRows(composer.renderFrame({ columns: 60, rows: 24 }).viewport).join("\n");
			expect(top).toContain("old 0");
		} finally {
			composer.stop();
		}
	});

	it("maps clicks to the rows of a scrolled window", () => {
		const { composer } = buildComposer();
		try {
			const transcript = new TranscriptContainer();
			transcript.addChild(new ClickableBlock(["card one", "card two"], ["AgentA"]));
			for (let index = 0; index < 8; index++) {
				transcript.addChild(new FinalBlock([`row ${index} a`, `row ${index} b`]));
			}
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);
			composer.renderFrame({ columns: 60, rows: 14 });
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);

			const rows = plainRows(composer.renderFrame({ columns: 60, rows: 14 }).viewport);
			const cardRow = rows.findIndex(row => row.includes("card one"));
			expect(cardRow).toBeGreaterThanOrEqual(0);
			expect(composer.viewportClickCandidates(cardRow)).toEqual(["AgentA"]);
			expect(composer.viewportClickCandidates(cardRow + 1)).toEqual(["AgentA"]);
		} finally {
			composer.stop();
		}
	});

	it("dispatches clicks to component-owned targets in fullscreen", () => {
		const { composer } = buildComposer();
		try {
			const toggle = new ToggleBlock(["card one", "card two"]);
			const transcript = new TranscriptContainer();
			transcript.addChild(toggle);
			for (let index = 0; index < 8; index++) {
				transcript.addChild(new FinalBlock([`row ${index} a`, `row ${index} b`]));
			}
			composer.setRuntimeChildren([transcript]);
			composer.setFullscreen(true);
			composer.renderFrame({ columns: 60, rows: 14 });
			composer.scrollTranscript(Number.MAX_SAFE_INTEGER);

			const rows = plainRows(composer.renderFrame({ columns: 60, rows: 14 }).viewport);
			const cardRow = rows.findIndex(row => row.includes("card one"));
			expect(cardRow).toBeGreaterThanOrEqual(0);
			expect(composer.viewportClickCandidates(cardRow)).toHaveLength(1);
			expect(composer.clickViewportTarget(cardRow)).toBe(true);
			expect(toggle.toggles).toBe(1);
		} finally {
			composer.stop();
		}
	});
});
