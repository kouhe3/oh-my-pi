import { describe, expect, it } from "bun:test";
import { type TerminalFramePlan, type TerminalFrameProvider, TUI, type ViewportSize } from "@oh-my-pi/pi-tui";
import type { Terminal, TerminalAppearance } from "@oh-my-pi/pi-tui/terminal";

const TRACKING_ON = "\x1b[?1000h\x1b[?1003h\x1b[?1006h";
const TRACKING_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1000l";

/** Minimal terminal that captures every escape byte the engine writes. */
class RecordingTerminal implements Terminal {
	columns = 40;
	rows = 6;
	kittyProtocolActive = false;
	kittyEnableSequence: string | null = null;
	keyboardEnhancementEnterSequence: string | null = null;
	keyboardEnhancementExitSequence: string | null = null;
	appearance: TerminalAppearance | undefined;
	writes: string[] = [];
	#onInput: ((data: string) => void) | undefined;

	start(onInput: (data: string) => void, _onResize: () => void): void {
		this.#onInput = onInput;
	}

	stop(): void {
		this.#onInput = undefined;
	}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	sendInput(data: string): void {
		this.#onInput?.(data);
	}

	write(data: string): void {
		this.writes.push(data);
	}

	moveBy(_lines: number): void {}

	hideCursor(): void {}

	showCursor(): void {}

	clearLine(): void {}

	clearFromCursor(): void {}

	clearScreen(): void {}

	setTitle(_title: string): void {}

	setProgress(_active: boolean): void {}

	onAppearanceChange(_callback: (appearance: TerminalAppearance) => void): void {}

	text(): string {
		return this.writes.join("");
	}
}

class Provider implements TerminalFrameProvider {
	plan: TerminalFramePlan;
	acknowledged: number[] = [];

	constructor(plan: TerminalFramePlan) {
		this.plan = plan;
	}

	renderFrame(_viewport: ViewportSize): TerminalFramePlan {
		return this.plan;
	}

	acknowledgeHistory(id: number): void {
		this.acknowledged.push(id);
		this.plan = { viewport: this.plan.viewport };
	}
}

const immediateScheduler = {
	now: () => 0,
	scheduleImmediate: (callback: () => void) => callback(),
	scheduleRender: (callback: () => void) => {
		callback();
		return { cancel() {} };
	},
};

function setup(
	plan: TerminalFramePlan,
	persistentAlt = false,
): { terminal: RecordingTerminal; provider: Provider; tui: TUI } {
	const terminal = new RecordingTerminal();
	const tui = new TUI(terminal, undefined, { renderScheduler: immediateScheduler });
	// Mount the provider first only after the mode is set: the provider's first frame
	// decides the buffer, exactly like a session that starts in fullscreen.
	if (persistentAlt) tui.setPersistentAltScreen(true);
	const provider = new Provider(plan);
	tui.setFrameProvider(provider);
	return { terminal, provider, tui };
}

describe("persistent alt-screen main view", () => {
	it("paints the provider frame on the alternate screen and acks history without writing it", () => {
		const { terminal, provider, tui } = setup(
			{
				history: { id: 1, rows: ["retired row"] },
				viewport: ["live row"],
			},
			true,
		);

		tui.start();

		const log = terminal.text();
		expect(log).toContain("\x1b[?1049h");
		expect(log).toContain("live row");
		// The alternate buffer has no scrollback: offered rows are retained by the host.
		expect(log).not.toContain("retired row");
		expect(provider.acknowledged).toEqual([1]);
	});

	it("reports the painted window so inline click routing keeps its geometry", () => {
		const { tui } = setup({ viewport: ["one", "two", "three"] }, true);
		tui.start();

		expect(tui.getMutableViewport()).toEqual({ top: 0, length: 6 });
	});

	it("reports wheel, clicks, and hover motion in fullscreen without the inline provider", () => {
		const { terminal, tui } = setup({ viewport: ["live row"] }, true);
		tui.start();

		// The fullscreen main view owns the pointer for the session, so hover and
		// clicks do not wait for `tui.mouse`.
		expect(terminal.text()).toContain(TRACKING_ON);
	});

	it("leaves normal-buffer reporting opt-in while inline", () => {
		const { terminal, tui } = setup({ viewport: ["live row"] });
		tui.start();
		expect(terminal.text()).not.toContain(TRACKING_ON);

		tui.setInlineMouseTrackingProvider(() => true);
		terminal.writes.length = 0;
		tui.requestRender(true);
		expect(terminal.text()).toContain(TRACKING_ON);
	});

	it("leaves the alternate screen and commits history again when disabled", () => {
		const { terminal, provider, tui } = setup(
			{
				history: { id: 1, rows: ["retired row"] },
				viewport: ["live row"],
			},
			true,
		);
		tui.start();
		terminal.writes.length = 0;

		tui.setPersistentAltScreen(false);
		provider.plan = { history: { id: 2, rows: ["retired again"] }, viewport: ["live again"] };
		tui.requestRender(true);

		expect(terminal.text()).toContain("\x1b[?1049l");
		expect(terminal.text()).toContain(TRACKING_OFF);
		expect(terminal.text()).toContain("retired again");
		expect(terminal.text()).toContain("live again");
		expect(tui.getMutableViewport().top).toBeGreaterThan(0);
	});

	it("rewrites only the rows a repaint moved", () => {
		const { terminal, provider, tui } = setup({ viewport: ["row one", "row two", "row three"] }, true);
		tui.start();
		expect(terminal.text()).toContain("row one");

		// One row changes: a scroll-frame diff must not re-emit the untouched rows.
		terminal.writes.length = 0;
		provider.plan = { viewport: ["row one", "row two", "row three changed"] };
		tui.requestRender();
		const repaint = terminal.text();
		expect(repaint).toContain("row three changed");
		expect(repaint).not.toContain("row one");
		expect(repaint).not.toContain("row two");
	});
});
