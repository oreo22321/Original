"""Discord に繋がずに、コマンドの定義・ボタンの形・注文の流れを確かめるテスト。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

import discord
import pytest

from vending import embeds, ui
from vending.client import VendingBot
from vending.config import Config, load_env_file
from vending.store import COMPLETED, PENDING, Store

GUILD = 1
BUYER = 100
ADMIN = 200


def run(coro):
    return asyncio.run(coro)


def make_bot() -> VendingBot:
    config = Config(token="x", database_path=Path(":memory:"), sync_guild_id=None, max_quantity=50, max_pending=3)
    return VendingBot(config, Store(":memory:"))


# ---------------------------------------------------------------- コマンド定義

def test_commands_serialize_within_discord_limits():
    async def main():
        bot = make_bot()
        commands = bot.tree.get_commands()
        names = sorted(c.name for c in commands)
        assert names == ["history", "orders", "panel", "product", "sales", "setup", "stock"]
        for command in commands:
            payload = command.to_dict(bot.tree)

            def check(node):
                assert 1 <= len(node["name"]) <= 32
                assert 1 <= len(node["description"]) <= 100, node["description"]
                options = node.get("options", [])
                assert len(options) <= 25
                for option in options:
                    check(option)
                    for choice in option.get("choices", []):
                        assert len(choice["name"]) <= 100

            check(payload)
        admin_only = {c.name for c in commands if c.default_permissions is not None}
        assert admin_only == {"setup", "product", "stock", "panel", "orders", "sales"}

    run(main())


# ---------------------------------------------------------------- パネルとボタン

def products(store: Store, count: int):
    for i in range(count):
        p = store.add_product(GUILD, f"商品{i}" + "あ" * 95, 100 * (i + 1), description="説明" * 400)
        if i % 2 == 0:
            store.add_stock(GUILD, p.id, [f"code-{i}"])
    return store.list_products(GUILD)


@pytest.mark.parametrize("count", [0, 3, 25, 26, 130])
def test_panel_fits_discord_limits(count):
    async def main():
        store = Store(":memory:")
        items = products(store, count)
        embed = embeds.panel_embed(embeds.DEFAULT_PANEL_TITLE, "説" * 1000, items)
        assert len(embed) <= 6000 and len(embed.fields) <= 25
        view = ui.panel_view(items)
        rows = view.to_components()
        assert 1 <= len(rows) <= 5
        selects = [row["components"][0] for row in rows]
        for index, select in enumerate(selects):
            assert select["custom_id"] == f"vend:panel:{index}"
            assert 1 <= len(select["options"]) <= 25
            for option in select["options"]:
                assert len(option["label"]) <= 100 and len(option.get("description", "")) <= 100
        if count == 0:
            assert selects[0]["disabled"] is True

    run(main())


def test_dynamic_item_templates_match_their_custom_ids():
    async def main():
        items = [
            ui.BuyButton(12),
            ui.ApproveButton(34),
            ui.RejectButton(34),
            ui.CancelButton(56),
            ui.panel_view([]).children[0],
        ]
        for item in items:
            assert type(item).__discord_ui_compiled_template__.fullmatch(item.custom_id)
        assert {cls.__name__ for cls in ui.DYNAMIC_ITEMS} == {type(i).__name__ for i in items}

    run(main())


def test_modals_fit_discord_limits():
    async def main():
        store = Store(":memory:")
        product = store.add_product(GUILD, "とても長い商品名" * 10, 100)
        unlimited = store.add_product(GUILD, "x", 100, unlimited_content="link")
        modals = [
            ui.PurchaseModal(product, 50),
            ui.PurchaseModal(unlimited, 50),
            ui.ProductModal(),
            ui.ProductModal(product=product),
            ui.StockModal(product),
            ui.PaymentModal("銀行"),
            ui.RejectModal(123456),
        ]
        for modal in modals:
            assert len(modal.title) <= 45
            assert 1 <= len(modal.children) <= 5
            for label in modal.children:
                assert isinstance(label, discord.ui.Label)
                assert len(label.text) <= 45, label.text
                assert len(label.description or "") <= 100, label.description
                assert len(label.component.placeholder or "") <= 100, label.component.placeholder
            modal.to_components()
        assert len(ui.PurchaseModal(unlimited, 50).children) == 1  # 無制限の商品は数量を聞かない

    run(main())


def test_delivery_payload_formats():
    store = Store(":memory:")
    p = store.add_product(GUILD, "x", 100)
    store.add_stock(GUILD, p.id, ["AAAA-BBBB", "https://example.com/a"] + [f"long-{i}" * 50 for i in range(30)])

    def deliver(qty):
        order = store.create_order(GUILD, BUYER, p.id, qty, "memo", max_pending=99)
        return store.approve_order(GUILD, order.id, ADMIN)

    short = embeds.delivery_payload(deliver(1), "サーバー")
    assert short["embed"].description == "```\nAAAA-BBBB\n```" and "file" not in short
    link = embeds.delivery_payload(deliver(1))
    assert link["embed"].description == "https://example.com/a"  # リンクはタップで開けるように
    big = embeds.delivery_payload(deliver(30))
    assert "file" in big and big["file"].filename.endswith(".txt")


def test_parse_number():
    assert ui.parse_number(" １２ ") == 12
    assert ui.parse_number("1,500") == 1500
    assert ui.parse_number("²") is None
    assert ui.parse_number("abc") is None


def test_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text('# c\nVEND_A="quoted"\nexport VEND_B = plain\nVEND_C=keep\n', encoding="utf-8")
    monkeypatch.setenv("VEND_C", "already")
    monkeypatch.delenv("VEND_A", raising=False)
    monkeypatch.delenv("VEND_B", raising=False)
    load_env_file(env)
    import os

    assert (os.environ["VEND_A"], os.environ["VEND_B"], os.environ["VEND_C"]) == ("quoted", "plain", "already")
    for key in ("VEND_A", "VEND_B"):
        monkeypatch.delenv(key)


# ---------------------------------------------------------------- 注文の流れ (偽の Discord で)

class Recorder(list):
    def of(self, kind):
        return [entry for entry in self if entry[0] == kind]


class FakeResponse:
    def __init__(self, rec):
        self.rec = rec
        self.done = False

    def is_done(self):
        return self.done

    async def send_message(self, content=None, **kw):
        self.done = True
        self.rec.append(("send", content, kw))

    async def defer(self, **kw):
        self.done = True
        self.rec.append(("defer", kw))

    async def send_modal(self, modal):
        self.done = True
        self.rec.append(("modal", modal))

    async def edit_message(self, **kw):
        self.done = True
        self.rec.append(("edit", kw))


class FakeInteraction:
    def __init__(self, bot, user_id, guild):
        self.rec = Recorder()
        self.client = bot
        self.user = SimpleNamespace(id=user_id)
        self.guild = guild
        self.guild_id = guild.id
        self.response = FakeResponse(self.rec)
        self.followup = SimpleNamespace(send=self._followup)
        self.message = None

    async def _followup(self, content=None, **kw):
        self.rec.append(("followup", content, kw))

    async def edit_original_response(self, **kw):
        self.rec.append(("edit_original", kw))


class FakeChannel:
    id = 555

    def __init__(self):
        self.sent = []

    async def send(self, content=None, **kw):
        self.sent.append((content, kw))
        return SimpleNamespace(id=777, channel=self)


class FakeUser:
    def __init__(self):
        self.dms = []

    async def send(self, **kw):
        self.dms.append(kw)


def setup_flow():
    bot = make_bot()
    channel = FakeChannel()
    buyer = FakeUser()
    refreshed = []

    async def resolve_channel(channel_id):
        return channel if channel_id == channel.id else None

    bot.resolve_channel = resolve_channel
    bot.get_user = lambda user_id: buyer if user_id == BUYER else None
    bot.panels = SimpleNamespace(schedule=refreshed.append)
    guild = SimpleNamespace(id=GUILD, name="テストサーバー", get_role=lambda role_id: None)
    bot.store.update_settings(GUILD, admin_channel_id=channel.id, payment_info="銀行振込")
    product = bot.store.add_product(GUILD, "ギフトコード", 500)
    bot.store.add_stock(GUILD, product.id, ["CODE-1", "CODE-2"])
    return bot, channel, buyer, guild, product, refreshed


def test_purchase_approve_flow():
    async def main():
        bot, channel, buyer, guild, product, refreshed = setup_flow()

        # 購入ボタン → 入力フォーム
        click = FakeInteraction(bot, BUYER, guild)
        await ui.BuyButton(product.id).callback(click)
        modal = click.rec.of("modal")[0][1]
        assert isinstance(modal, ui.PurchaseModal)

        # フォーム送信 → 注文が確認チャンネルに届き、購入者にはキャンセルボタン付きの控え
        submit = FakeInteraction(bot, BUYER, guild)
        modal.quantity._value = "２"
        modal.note._value = "11/17 振込 ヤマダ"
        await modal.on_submit(submit)
        (content, kw), = channel.sent
        assert kw["embed"].title == "注文 #1"
        assert [c["custom_id"] for c in kw["view"].to_components()[0]["components"]] == ["vend:approve:1", "vend:reject:1"]
        receipt = submit.rec.of("followup")[0][2]
        assert receipt["ephemeral"] and receipt["view"].children[0].custom_id == "vend:cancel:1"
        order = bot.store.get_order(GUILD, 1)
        assert order.status == PENDING and order.quantity == 2 and order.admin_message_id == 777
        assert bot.store.get_product(GUILD, product.id).sold_out
        assert refreshed == [GUILD]

        # 承認 → DM で商品が届き、確認メッセージのボタンが消える
        approve = FakeInteraction(bot, ADMIN, guild)
        await ui.ApproveButton(1).callback(approve)
        assert bot.store.get_order(GUILD, 1).status == COMPLETED
        assert buyer.dms[0]["embed"].description == "```\nCODE-1\nCODE-2\n```"
        edited = approve.rec.of("edit_original")[0][1]
        assert edited["view"] is None and "DM で商品を送りました" in edited["embed"].fields[-1].value

        # 同じ注文をもう一度承認しても二重に送らない
        again = FakeInteraction(bot, ADMIN, guild)
        await ui.ApproveButton(1).callback(again)
        assert len(buyer.dms) == 1
        assert "処理済み" in again.rec.of("followup")[0][1]

    run(main())


def test_reject_and_cancel_flow():
    async def main():
        bot, channel, buyer, guild, product, _ = setup_flow()
        order = bot.store.create_order(GUILD, BUYER, product.id, 1, "memo")

        # 他人のキャンセルは受け付けない
        stranger = FakeInteraction(bot, BUYER + 1, guild)
        await ui.CancelButton(order.id).callback(stranger)
        assert "見つかりません" in stranger.rec.of("send")[0][1]

        reject = ui.RejectModal(order.id)
        reject.reason._value = "入金が確認できませんでした"
        admin = FakeInteraction(bot, ADMIN, guild)
        await reject.on_submit(admin)
        assert bot.store.get_order(GUILD, order.id).status == "rejected"
        assert buyer.dms[0]["embed"].fields[-2].value == "入金が確認できませんでした"
        assert bot.store.get_product(GUILD, product.id).stock == 2

        second = bot.store.create_order(GUILD, BUYER, product.id, 1, "memo")
        owner = FakeInteraction(bot, BUYER, guild)
        await ui.CancelButton(second.id).callback(owner)
        assert owner.rec.of("edit")[0][1]["view"] is None
        assert bot.store.get_order(GUILD, second.id).status == "cancelled"

    run(main())


def test_buy_button_requires_setup_and_stock():
    async def main():
        bot, channel, buyer, guild, product, _ = setup_flow()
        bot.store.update_settings(GUILD, admin_channel_id=None)
        click = FakeInteraction(bot, BUYER, guild)
        await ui.BuyButton(product.id).callback(click)
        assert "/setup channel" in click.rec.of("send")[0][1]

        bot.store.update_settings(GUILD, admin_channel_id=channel.id)
        bot.store.clear_stock(GUILD, product.id)
        click = FakeInteraction(bot, BUYER, guild)
        await ui.BuyButton(product.id).callback(click)
        assert "売り切れ" in click.rec.of("send")[0][1]

    run(main())
