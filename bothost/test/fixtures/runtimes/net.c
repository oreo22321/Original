#include <windows.h>
#include <winhttp.h>
#include <stdio.h>
int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  HINTERNET s = WinHttpOpen(L"bothost-test/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!s) { printf("open failed %lu\n", GetLastError()); return 1; }
  HINTERNET c = WinHttpConnect(s, L"discord.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
  HINTERNET r = WinHttpOpenRequest(c, L"GET", L"/api/v10/gateway", NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
  if (!WinHttpSendRequest(r, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(r, NULL)) { printf("request failed %lu\n", GetLastError()); return 2; }
  DWORD code = 0, sz = sizeof(code);
  WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &code, &sz, NULL);
  char buf[512] = {0}; DWORD n = 0;
  WinHttpReadData(r, buf, sizeof(buf) - 1, &n);
  printf("status=%lu body=%s\n", code, buf);
  return 0;
}
