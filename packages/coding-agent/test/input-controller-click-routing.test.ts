import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { PINNED_HUD_TOGGLE_ID } from "@oh-my-pi/pi-tui/prompt/composer";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

const ESC = String.fromCharCode(27);
// SGR click on viewport row 2 (1-based y=3): the pinned expander row when the
// candidates below resolve it to the toggle sentinel.
const EXPANDER_CLICK = `${ESC}[<0;5;3M`;
// SGR pointer motion (button 35) over the same row.
const EXPANDER_HOVER = `${ESC}[<35;5;3M`;
function makeHarness(options: { fullscreen?: boolean } = {}) {
	const listeners: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
	const focused: string[] = [];
	const hovered: (string | undefined)[] = [];
	let toggled = 0;
	const ctx = {
		ui: {
			addInputListener: (fn: (data: string) => { consume?: boolean; data?: string } | undefined) => {
				listeners.push(fn);
			},
			getMutableViewport: () => ({ top: 0, length: 5 }),
			hasOverlay: () => false,
			requestRender: () => {},
			addStartListener: () => {},
			getFocused: () => undefined,
		},
		handlesBtwBranchKey: () => false,
		editor: {
			getText: () => "",
			setActionKeys: () => {},
			setCustomKeyHandler: () => {},
			clearCustomKeyHandlers: () => {},
		},
		keybindings: KeybindingsManager.inMemory(),
		session: {
			extensionRunner: undefined,
		},
		composer: {
			get fullscreen() {
				return options.fullscreen === true;
			},
			setFullscreen: () => {},
			scrollTranscript: () => {},
			scrollTranscriptPage: () => {},
			scrollToTranscriptTail: () => {},
		},
		resolveViewportClickCandidates: (index: number) => (index === 2 ? [PINNED_HUD_TOGGLE_ID] : []),
		focusedAgentId: undefined,
		focusAgentSession: async (id: string) => {
			focused.push(id);
		},
		togglePinnedHudExpanded: () => {
			toggled++;
		},
		showStatus: () => {},
		setClickHoverId: (id: string | undefined) => {
			hovered.push(id);
		},
	} as unknown as InteractiveModeContext;
	const controller = new InputController(ctx);
	controller.setupKeyHandlers();
	const send = (data: string) => {
		for (const listener of listeners) listener(data);
	};
	return {
		click: () => send(EXPANDER_CLICK),
		hover: () => send(EXPANDER_HOVER),
		focused,
		hovered,
		toggled: () => toggled,
	};
}

describe("InputController click routing", () => {
	beforeEach(async () => {
		AgentRegistry.resetGlobalForTests();
		await Settings.init({ inMemory: true });
		settings.set("tui.mouse", true);
	});

	afterEach(() => {
		AgentRegistry.resetGlobalForTests();
		resetSettingsForTest();
	});

	it("focuses a live agent whose id equals the toggle sentinel", () => {
		AgentRegistry.global().register({
			id: PINNED_HUD_TOGGLE_ID,
			displayName: "evil",
			kind: "sub",
			session: {} as unknown as AgentSession,
			sessionFile: null,
		});
		const h = makeHarness();
		h.click();
		expect(h.focused).toEqual([PINNED_HUD_TOGGLE_ID]);
		expect(h.toggled()).toBe(0);
	});

	it("toggles when no live agent matches the sentinel", () => {
		const h = makeHarness();
		h.click();
		expect(h.toggled()).toBe(1);
		expect(h.focused).toEqual([]);
	});

	it("hovers click targets in fullscreen even with tui.mouse off", () => {
		settings.set("tui.mouse", false);
		const h = makeHarness({ fullscreen: true });
		h.hover();
		expect(h.hovered).toEqual([PINNED_HUD_TOGGLE_ID]);
		expect(h.focused).toEqual([]);
	});

	it("keeps hover inert inline while tui.mouse is off", () => {
		settings.set("tui.mouse", false);
		const h = makeHarness();
		h.hover();
		expect(h.hovered).toEqual([]);
	});
});
