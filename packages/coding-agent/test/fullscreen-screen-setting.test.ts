import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { ToolExecutionComponent } from "@oh-my-pi/pi-tui/chat/tool-execution";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getDefault, SETTINGS_SCHEMA } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { Text } from "@oh-my-pi/pi-tui";
import { Composer } from "@oh-my-pi/pi-tui/prompt/composer";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { TempDir } from "@oh-my-pi/pi-utils";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

const WHEEL_UP = "\x1b[<64;5;3M";
const WHEEL_DOWN = "\x1b[<65;5;3M";
const LEFT_CLICK = "\x1b[<0;5;3M";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";
/** `app.screen.toggle` as every terminal encodes Alt+F (kitty sends `\x1b[102;6u` too). */
const TOGGLE_SCREEN = "\x1bf";

describe("tui.screen fullscreen main view", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;
	let term: VirtualTerminal;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@omp-screen-setting-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		term = new VirtualTerminal(120, 32);
		const composer = new Composer({ terminal: term });
		mode = new InteractiveMode(session, "test", undefined, () => {}, undefined, undefined, new EventBus(), composer);
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	/** Boot the session and fill the transcript past one fullscreen window. */
	async function bootFullscreen(): Promise<void> {
		settings.set("tui.screen", "fullscreen");
		settings.set("tui.mouse", false);
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();
		expect(mode.composer.fullscreen).toBe(true);
		for (let index = 0; index < 60; index++) {
			mode.chatContainer.addChild(new Text(`transcript row ${index}`));
		}
		mode.ui.requestRender();
		await term.waitForRender();
	}

	it("defaults tui.screen to inline and starts the session inline", async () => {
		expect(SETTINGS_SCHEMA["tui.screen"]).toMatchObject({
			type: "enum",
			values: ["inline", "fullscreen"],
			default: "inline",
		});
		expect(getDefault("tui.screen")).toBe("inline");

		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();
		expect(mode.composer.fullscreen).toBe(false);
	});

	it("applies tui.screen through the settings-editor path", async () => {
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();
		const controller = new SelectorController(mode);

		// The settings editor persists through the global store, then notifies the
		// controller (see createSettingsHost + SettingsSelectorComponent.onChange).
		settings.set("tui.screen", "fullscreen");
		controller.handleSettingChange("tui.screen", "fullscreen");
		expect(mode.composer.fullscreen).toBe(true);

		settings.set("tui.screen", "inline");
		controller.handleSettingChange("tui.screen", "inline");
		expect(mode.composer.fullscreen).toBe(false);
	});

	const HINT = "earlier lines, showing";

	/** Terminal screen text with styling stripped. */
	function screenText(): string {
		return Bun.stripANSI(term.getViewport().join("\n"));
	}

	/** Add a bash card whose output collapses behind an expansion hint. */
	async function addLongToolCard(): Promise<void> {
		const card = new ToolExecutionComponent(
			"bash",
			{ command: "seq 1 200" },
			{},
			{} as AgentTool,
			mode.ui,
			tempDir.path(),
		);
		mode.chatContainer.addChild(card);
		card.updateResult(
			{
				content: [{ type: "text", text: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n") }],
				details: {},
			},
			false,
		);
		await term.waitForRender(() => screenText().includes(HINT));
	}

	/** Press the left button on the card's hint row: the whole card is the target. */
	function clickCard(): void {
		const hintRow = screenText()
			.split("\n")
			.findIndex(row => row.includes(HINT));
		expect(hintRow).toBeGreaterThanOrEqual(0);
		term.sendInput(`\x1b[<0;5;${hintRow + 1}M`);
	}

	it("expands a tool card when its rows are clicked in fullscreen", async () => {
		settings.set("tui.screen", "fullscreen");
		settings.set("tui.mouse", false);
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();

		await addLongToolCard();
		clickCard();
		await term.waitForRender(() => !screenText().includes(HINT));
	});

	it("expands a tool card on a pointer click inline while tui.mouse is on", async () => {
		settings.set("tui.screen", "inline");
		settings.set("tui.mouse", true);
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();

		await addLongToolCard();
		clickCard();
		await term.waitForRender(() => !screenText().includes(HINT));
	});

	it("ignores pointer clicks inline while tui.mouse is off", async () => {
		settings.set("tui.screen", "inline");
		settings.set("tui.mouse", false);
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();

		await addLongToolCard();
		clickCard();
		mode.ui.requestRender();
		await term.waitForRender();
		expect(screenText()).toContain(HINT);
	});

	it("toggles the view with the app.screen.toggle chord", async () => {
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();
		expect(mode.composer.fullscreen).toBe(false);

		term.sendInput(TOGGLE_SCREEN); // Alt+F
		await term.waitForRender();
		expect(mode.composer.fullscreen).toBe(true);
		expect(Bun.stripANSI(term.getViewport().join("\n"))).toContain("Fullscreen view: on");

		term.sendInput(TOGGLE_SCREEN);
		await term.waitForRender();
		expect(mode.composer.fullscreen).toBe(false);
		expect(Bun.stripANSI(term.getViewport().join("\n"))).toContain("Fullscreen view: off");
	});

	it("scrolls the transcript on the wheel while tui.mouse is off", async () => {
		await bootFullscreen();
		expect(mode.composer.getTranscriptScroll().offset).toBe(0);

		term.sendInput(WHEEL_UP);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBeGreaterThan(0);

		const scrolled = mode.composer.getTranscriptScroll().offset;
		term.sendInput(WHEEL_DOWN);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBeLessThan(scrolled);
	});

	it("swallows SGR clicks in fullscreen without touching the draft", async () => {
		await bootFullscreen();
		mode.editor.setText("keep this draft");
		mode.ui.requestRender();
		await term.waitForRender();

		term.sendInput(LEFT_CLICK);
		await term.waitForRender();
		expect(mode.editor.getText()).toBe("keep this draft");
		expect(mode.composer.getTranscriptScroll().offset).toBe(0);
	});

	it("pages and jumps the transcript with the reader keys", async () => {
		await bootFullscreen();

		term.sendInput(PAGE_UP);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBeGreaterThan(0);

		const paged = mode.composer.getTranscriptScroll().offset;
		term.sendInput(PAGE_DOWN);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBeLessThan(paged);

		term.sendInput(HOME);
		await term.waitForRender();
		const atTop = mode.composer.getTranscriptScroll();
		expect(atTop.offset).toBeGreaterThan(0);
		expect(atTop.hasMoreAbove).toBe(false);

		term.sendInput(END);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBe(0);
	});

	it("leaves the reader keys to a non-empty editor", async () => {
		await bootFullscreen();
		mode.editor.setText("a draft owns the keys");
		mode.ui.requestRender();
		await term.waitForRender();

		term.sendInput(PAGE_UP);
		term.sendInput(HOME);
		await term.waitForRender();
		expect(mode.composer.getTranscriptScroll().offset).toBe(0);
		expect(mode.editor.getText()).toBe("a draft owns the keys");
	});
});
