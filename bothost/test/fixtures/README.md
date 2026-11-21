# テスト用のデータ

- `sample-backup.json.gz`: GitHub からの復元を確かめるための、バックアップのサンプルです。
  中身はテスト用のダミーだけです (ユーザー `restore-test` / パスワード `restore-password-1`、bot `restored-bot`)。
  GitHub Actions の「BotHost (本物のネットワーク)」で、空のサーバーがこのファイルを GitHub から読んで元に戻せるかを確かめます。
