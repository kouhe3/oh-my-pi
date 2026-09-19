import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import type { TUI } from "@oh-my-pi/pi-tui";
import { ToolExecutionComponent } from "@oh-my-pi/pi-tui/chat/tool-execution";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

function createBashCard(): ToolExecutionComponent {
	const ui = { requestRender: () => {} } as unknown as TUI;
	const tool = {} as unknown as AgentTool;
	return new ToolExecutionComponent("bash", { command: "seq 1 200" }, {}, tool, ui, "/tmp");
}

describe("tool card pointer click", () => {
	beforeAll(async () => {
		await initTheme();
	});

	test("toggles the output preview the same way Ctrl+O does", () => {
		const component = createBashCard();
		try {
			const output = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
			component.updateResult({ content: [{ type: "text", text: output }], details: {} }, false);

			const collapsed = Bun.stripANSI(component.render(80).join("\n"));
			expect(collapsed).toContain("earlier lines, showing");
			expect(collapsed).not.toContain("line 0 ");

			component.handleTranscriptClick();
			const expanded = Bun.stripANSI(component.render(80).join("\n"));
			expect(expanded).not.toContain("earlier lines, showing");
			expect(expanded).toContain("line 0 ");

			component.handleTranscriptClick();
			expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("earlier lines, showing");
		} finally {
			component.stopAnimation();
		}
	});
});
