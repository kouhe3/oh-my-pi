import { beforeAll, describe, expect, it } from "bun:test";
import { COMPOSER_DEFAULTS, Composer, type TranscriptCommitMode } from "@oh-my-pi/pi-tui/prompt/composer";
import { TranscriptContainer } from "@oh-my-pi/pi-tui/chrome/transcript-container";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { type Component, Container, Text } from "@oh-my-pi/pi-tui";
import { VirtualRenderScheduler } from "./virtual-render-scheduler";
import { VirtualTerminal } from "./virtual-terminal";
import { withoutTerminalMultiplexer } from "./terminal-multiplexer-environment";

withoutTerminalMultiplexer();

const COLUMNS = 100;
const ROWS = 40;
const ROW_PREFIX = "COMMIT-ROW-";

/** Transcript block whose rows and finalized state a test can flip at will. */
class CommitBlock implements Component {
	settled: boolean;
	rows: string[];

	constructor(rows: number, settled: boolean) {
		this.rows = Array.from({ length: rows }, (_, i) => `${ROW_PREFIX}${i}`);
		this.settled = settled;
	}

	isTranscriptBlockFinalized(): boolean {
		return this.settled;
	}

	render(): readonly string[] {
		return this.rows;
	}
}

interface Harness {
	terminal: VirtualTerminal;
	scheduler: VirtualRenderScheduler;
	composer: Composer;
	transcript: TranscriptContainer;
	block: CommitBlock;
}

function makeHarness(mode: TranscriptCommitMode, rows: number, settled = true, welcome = false): Harness {
	const terminal = new VirtualTerminal(COLUMNS, ROWS);
	const scheduler = new VirtualRenderScheduler();
	const composer = new Composer({
		terminal,
		tuiOptions: { renderScheduler: scheduler },
		preferences: { ...COMPOSER_DEFAULTS, quiet: !welcome, transcriptCommit: mode },
		welcome: welcome ? { version: "0.0.0-test", modelName: "TestModelRow", providerName: "TestProvider" } : undefined,
	});
	const transcript = new TranscriptContainer();
	const block = new CommitBlock(rows, settled);
	transcript.addChild(block);
	const editor = new Container();
	editor.addChild(new Text("EDITOR", 0, 0));
	composer.setRuntimeChildren([transcript, editor]);
	composer.start({ playWelcomeIntro: false });
	return { terminal, scheduler, composer, transcript, block };
}

/** Plain rows the terminal currently holds, split at the native-scrollback boundary. */
function bufferRows(terminal: VirtualTerminal): { history: string[]; viewport: string[] } {
	const base = terminal.getBufferPosition().baseY;
	const rows = terminal.getScrollBuffer().map(row => Bun.stripANSI(row).trimEnd());
	return { history: rows.slice(0, base), viewport: rows.slice(base) };
}

beforeAll(async () => {
	await initTheme();
});

describe("transcript commit timing (tui.transcriptCommit)", () => {
	it("settle retires a finalized block while the screen still has room", async () => {
		const h = makeHarness("settle", 6);
		await h.scheduler.settle(h.terminal);

		expect(h.transcript.blockStates()).toEqual(["committed"]);
		h.composer.stop();
	});

	it("capacity keeps a finalized block live until the screen runs out of room", async () => {
		const h = makeHarness("capacity", 6);
		await h.scheduler.settle(h.terminal);

		expect(h.transcript.blockStates()).toEqual(["settled"]);
		h.composer.stop();
	});

	it("settle leaves an unfinalized block live", async () => {
		const h = makeHarness("settle", 6, false);
		await h.scheduler.settle(h.terminal);

		expect(h.transcript.blockStates()).toEqual(["active"]);
		h.composer.stop();
	});

	it("committed rows survive a repaint that rewrites the live viewport", async () => {
		const h = makeHarness("settle", 2);
		await h.scheduler.settle(h.terminal);
		h.block.rows = ["REWRITTEN-A", "REWRITTEN-B"];
		h.composer.ui.requestRender(true);
		await h.scheduler.settle(h.terminal);

		const { history, viewport } = bufferRows(h.terminal);
		const displayed = [...history, ...viewport];
		expect(displayed).toContain(`${ROW_PREFIX}0`);
		expect(displayed).not.toContain("REWRITTEN-A");
		h.composer.stop();
	});

	it("retires the welcome header before the settled transcript without further input", async () => {
		const h = makeHarness("settle", 2, true, true);
		await h.scheduler.settle(h.terminal);

		// The header must retire first (ordering), and its accepted batch must pump
		// the frame that commits the transcript behind it.
		expect(h.transcript.blockStates()).toEqual(["committed"]);
		const { history, viewport } = bufferRows(h.terminal);
		const displayed = [...history, ...viewport];
		const headerRow = displayed.findIndex(row => row.includes("TestModelRow"));
		const transcriptRow = displayed.findIndex(row => row.startsWith(`${ROW_PREFIX}0`));
		expect(headerRow).toBeGreaterThanOrEqual(0);
		expect(transcriptRow).toBeGreaterThan(headerRow);
		h.composer.stop();
	});
});
