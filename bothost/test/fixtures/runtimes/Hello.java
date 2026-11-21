public class Hello {
  public static void main(String[] a) throws Exception {
    System.out.println("hello from java " + System.getProperty("java.version") + " maxMB=" + (Runtime.getRuntime().maxMemory() >> 20));
    java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
    String line = r.readLine();
    System.out.println("got=" + line);
    System.exit(4);
  }
}
