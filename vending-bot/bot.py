"""Discord 自販機 Bot を起動します:  python bot.py"""
from pathlib import Path

from vending.client import VendingBot
from vending.config import load_config
from vending.store import Store


def main() -> None:
    config = load_config(Path(__file__).resolve().parent)
    store = Store(config.database_path)
    bot = VendingBot(config, store)
    bot.run(config.token, root_logger=True)


if __name__ == "__main__":
    main()
