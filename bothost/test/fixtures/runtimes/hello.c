#include <stdio.h>
#include <string.h>
#include <windows.h>
int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("hello from exe (%d-bit) args=%d\n", (int)(sizeof(void*) * 8), argc - 1);
  for (int i = 1; i < argc; i++) printf("arg%d=%s\n", i, argv[i]);
  char *t = getenv("BOT_TOKEN_TEST");
  printf("env=%s\n", t ? t : "(none)");
  char buf[256];
  if (fgets(buf, sizeof buf, stdin)) { buf[strcspn(buf, "\r\n")] = 0; printf("got=%s\n", buf); }
  Sleep(200);
  return 3;
}
