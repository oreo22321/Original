import pytest

from vending.store import CANCELLED, COMPLETED, PENDING, REJECTED, Store, StoreError

GUILD = 1
OTHER_GUILD = 2
BUYER = 100
ADMIN = 200


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "test.db")
    yield s
    s.close()


def stocked(store, lines=("A", "B", "C"), **kwargs):
    product = store.add_product(GUILD, "ギフトコード", 500, **kwargs)
    store.add_stock(GUILD, product.id, lines)
    return store.get_product(GUILD, product.id)


def test_add_stock_counts_non_empty_lines(store):
    product = store.add_product(GUILD, "コード", 300)
    assert product.stock == 0 and product.sold_out
    assert store.add_stock(GUILD, product.id, ["  x1 ", "", "x2", "   "]) == 2
    assert store.get_product(GUILD, product.id).stock == 2
    assert store.available_stock(GUILD, product.id) == ["x1", "x2"]


def test_order_reserves_stock_and_approval_delivers_in_order(store):
    product = stocked(store)
    order = store.create_order(GUILD, BUYER, product.id, 2, "振込 12:00 ヤマダ")
    assert order.status == PENDING
    assert order.total == 1000
    assert store.get_product(GUILD, product.id).stock == 1

    done = store.approve_order(GUILD, order.id, ADMIN)
    assert done.status == COMPLETED
    assert done.delivered == "A\nB"
    assert done.handled_by == ADMIN
    assert store.available_stock(GUILD, product.id) == ["C"]

    with pytest.raises(StoreError, match="処理済み"):
        store.approve_order(GUILD, order.id, ADMIN)


def test_reject_and_cancel_return_stock(store):
    product = stocked(store)
    first = store.create_order(GUILD, BUYER, product.id, 3, "memo")
    assert store.get_product(GUILD, product.id).sold_out
    rejected = store.reject_order(GUILD, first.id, ADMIN, "  入金なし ")
    assert rejected.status == REJECTED and rejected.reason == "入金なし"
    assert store.get_product(GUILD, product.id).stock == 3

    second = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    with pytest.raises(StoreError):
        store.cancel_order(GUILD, second.id, BUYER + 1)  # 他人はキャンセルできない
    cancelled = store.cancel_order(GUILD, second.id, BUYER)
    assert cancelled.status == CANCELLED
    assert store.available_stock(GUILD, product.id) == ["A", "B", "C"]


def test_insufficient_stock_and_sold_out(store):
    product = stocked(store, lines=["only"])
    with pytest.raises(StoreError, match="残り 1 個"):
        store.create_order(GUILD, BUYER, product.id, 2, "memo")
    store.create_order(GUILD, BUYER, product.id, 1, "memo")
    with pytest.raises(StoreError, match="売り切れ"):
        store.create_order(GUILD, BUYER + 1, product.id, 1, "memo")


def test_order_validation(store):
    product = stocked(store)
    with pytest.raises(StoreError):
        store.create_order(GUILD, BUYER, product.id, 0, "memo")
    with pytest.raises(StoreError):
        store.create_order(GUILD, BUYER, product.id, 1, "   ")
    with pytest.raises(StoreError, match="2 個まで"):
        store.create_order(GUILD, BUYER, product.id, 3, "memo", max_quantity=2)


def test_pending_limit_per_user(store):
    product = stocked(store, lines=[str(i) for i in range(10)])
    for _ in range(2):
        store.create_order(GUILD, BUYER, product.id, 1, "memo", max_pending=2)
    with pytest.raises(StoreError, match="確認待ち"):
        store.create_order(GUILD, BUYER, product.id, 1, "memo", max_pending=2)
    # 別の人は注文できる
    store.create_order(GUILD, BUYER + 1, product.id, 1, "memo", max_pending=2)


def test_unlimited_product(store):
    product = store.add_product(GUILD, "壁紙", 100, unlimited_content="https://example.com/dl")
    assert product.unlimited and product.stock is None and not product.sold_out
    with pytest.raises(StoreError):
        store.add_stock(GUILD, product.id, ["x"])
    with pytest.raises(StoreError):
        store.create_order(GUILD, BUYER, product.id, 2, "memo")
    order = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    assert store.approve_order(GUILD, order.id, ADMIN).delivered == "https://example.com/dl"


def test_cannot_switch_to_unlimited_while_stock_remains(store):
    product = stocked(store)
    with pytest.raises(StoreError, match="在庫"):
        store.update_product(
            GUILD, product.id, name="x", price=1, description="", unlimited_content="link"
        )
    store.clear_stock(GUILD, product.id)
    updated = store.update_product(GUILD, product.id, name="x", price=1, description="", unlimited_content="link")
    assert updated.unlimited


def test_remove_product_keeps_pending_orders(store):
    product = stocked(store)
    order = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    leftover = store.remove_product(GUILD, product.id)
    assert leftover == ["B", "C"]
    assert store.list_products(GUILD) == []
    assert store.get_product(GUILD, product.id) is None
    with pytest.raises(StoreError, match="販売を終了"):
        store.create_order(GUILD, BUYER + 1, product.id, 1, "memo")
    assert store.approve_order(GUILD, order.id, ADMIN).delivered == "A"


def test_clear_stock_does_not_touch_reserved(store):
    product = stocked(store)
    order = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    assert store.clear_stock(GUILD, product.id) == ["B", "C"]
    assert store.approve_order(GUILD, order.id, ADMIN).delivered == "A"


def test_guilds_are_isolated(store):
    product = stocked(store)
    assert store.get_product(OTHER_GUILD, product.id) is None
    assert store.find_product(OTHER_GUILD, str(product.id)) is None
    order = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    with pytest.raises(StoreError):
        store.approve_order(OTHER_GUILD, order.id, ADMIN)
    assert store.get_order(OTHER_GUILD, order.id) is None


def test_find_product_by_id_or_name(store):
    product = stocked(store)
    assert store.find_product(GUILD, str(product.id)).id == product.id
    assert store.find_product(GUILD, "ギフトコード").id == product.id
    assert store.find_product(GUILD, "ない商品") is None


def test_settings_and_sales(store):
    assert store.get_settings(GUILD).admin_channel_id is None
    store.update_settings(GUILD, admin_channel_id=5, payment_info="銀行振込")
    store.update_settings(GUILD, admin_role_id=7)
    settings = store.get_settings(GUILD)
    assert (settings.admin_channel_id, settings.admin_role_id, settings.payment_info) == (5, 7, "銀行振込")

    product = stocked(store)
    a = store.create_order(GUILD, BUYER, product.id, 2, "memo")
    store.create_order(GUILD, BUYER + 1, product.id, 1, "memo")
    store.approve_order(GUILD, a.id, ADMIN)
    sales = store.sales(GUILD)
    assert (sales.orders, sales.items, sales.revenue, sales.pending) == (1, 2, 1000, 1)
    assert sales.top == [("ギフトコード", 2, 1000)]


def test_order_snapshots_role_and_name(store):
    product = stocked(store, role_id=999)
    order = store.create_order(GUILD, BUYER, product.id, 1, "memo")
    store.update_product(GUILD, product.id, name="新しい名前", price=9999, description="", unlimited_content=None)
    order = store.get_order(GUILD, order.id)
    assert (order.product_name, order.unit_price, order.role_id) == ("ギフトコード", 500, 999)


def test_panels(store):
    store.add_panel(10, GUILD, 20, "title", "desc")
    store.add_panel(11, OTHER_GUILD, 21, "t", "d")
    assert [p.message_id for p in store.list_panels(GUILD)] == [10]
    store.remove_panel(10)
    assert store.list_panels(GUILD) == []


def test_data_survives_reopen(tmp_path):
    path = tmp_path / "persist.db"
    first = Store(path)
    product = first.add_product(GUILD, "x", 1)
    first.add_stock(GUILD, product.id, ["1", "2"])
    first.close()
    second = Store(path)
    assert second.get_product(GUILD, product.id).stock == 2
    second.close()
