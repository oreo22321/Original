'use strict';

const { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

/** モーダル (入力フォーム) を簡単に作るためのヘルパー */
function modal(customId, title, inputs) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  m.addLabelComponents(
    inputs.map(({ id, label, description, long = false, required = true, placeholder, value, min, max }) => {
      const input = new TextInputBuilder()
        .setCustomId(id)
        .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(required);
      if (placeholder) input.setPlaceholder(placeholder);
      if (value) input.setValue(String(value).slice(0, max ?? 4000));
      if (min !== undefined) input.setMinLength(min);
      if (max !== undefined) input.setMaxLength(max);
      const lbl = new LabelBuilder().setLabel(label).setTextInputComponent(input);
      if (description) lbl.setDescription(description);
      return lbl;
    }),
  );
  return m;
}

module.exports = { modal };
