const { MessageFlags } = require("discord.js");

module.exports = {
  name: "interactionCreate",
  async execute(client, interaction) {
    // ── Autocomplete ─────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd?.autocomplete) return;
      try {
        await cmd.autocomplete(interaction);
      } catch (err) {
        console.error("[Autocomplete Error]", err);
      }
      return;
    }

    // ── Buttons ──────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      try {
        const { handleButtonInteraction } = require("../src/utils/ui");
        await handleButtonInteraction(interaction);
      } catch (err) {
        console.error("[Button Error]", err);
      }
      return;
    }

    // ── Slash Commands ────────────────────────────────────────────────────────
    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(client, interaction);
    } catch (err) {
      console.error(`[Command Error] /${interaction.commandName}:`, err);
      const payload = {
        content: `❌ Something went wrong: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
