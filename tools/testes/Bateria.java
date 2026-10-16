// Bateria.java — roda DENTRO do laboratório (JDK 25 real). Lê casos pela entrada padrão,
// compila cada um com o javac (em processo, uma JVM só) e roda "java Classe" (um processo
// por vez, sequencial). Formato de entrada: registros separados por \u001e; cada registro:
//   id \t principal \t args(separados por \u001f) \t stdin \n  arquivo1 \u001c conteúdo \u001d arquivo2 \u001c conteúdo ...
// Saída: para cada caso, "\u001d" + id + "\n" + [saída do javac] + "\u001b" + [saída do java] + "[código de saída: N]\n"
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.tools.*;

public class Bateria {
    public static void main(String[] a) throws Exception {
        String tudo = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        Path base = Files.createTempDirectory("bat");
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        int n = 0;
        for (String reg : tudo.split("\u001e")) {
            if (reg.isEmpty()) continue;
            n++;
            int nl = reg.indexOf('\n');
            String[] cab = reg.substring(0, nl).split("\t", -1);
            String id = cab[0], principal = cab[1];
            List<String> args = cab[2].isEmpty() ? List.of() : Arrays.asList(cab[2].split("\u001f"));
            String stdin = cab[3].replace("\\n", "\n");
            boolean temStdin = cab.length > 4 && cab[4].equals("1");
            String nomeDir = "_q" + n + "_";
            Path dir = base.resolve(nomeDir);
            Files.createDirectories(dir);
            List<String> fontes = new ArrayList<>();
            for (String arq : reg.substring(nl + 1).split("\u001d")) {
                int s = arq.indexOf('\u001c');
                if (s < 0) continue;
                String nome = arq.substring(0, s);
                Files.writeString(dir.resolve(nome), arq.substring(s + 1));
                fontes.add(nome);
            }
            StringBuilder res = new StringBuilder();
            if (principal.equals("@jshell")) {
                stdin = Files.readString(dir.resolve("sessao.jsh"));
                res.append('\u001b').append(rodar(List.of("jshell", "-q"), dir, stdin, false));
                out.print("\u001d" + id + "\n" + res);
                continue;
            }
            // javac (em processo) — os caminhos ficam relativos à pasta do caso
            ByteArrayOutputStream errc = new ByteArrayOutputStream();
            List<String> jargs = new ArrayList<>(List.of("-d", dir.toString()));
            for (String f : fontes) jargs.add(dir.resolve(f).toString());
            int rc = jc.run(null, errc, errc, jargs.toArray(new String[0]));
            String msgs = errc.toString(StandardCharsets.UTF_8).replace(dir.toString() + "/", "");
            res.append(msgs).append('\u001b');
            if (rc == 0) {
                List<String> cmd = new ArrayList<>(List.of("java", principal));
                cmd.addAll(args);
                res.append(rodar(cmd, dir, stdin, true));
            }
            out.print("\u001d" + id + "\n" + res);
        }
    }

    static String rodar(List<String> cmd, Path dir, String stdin, boolean codigo) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd).redirectErrorStream(true).directory(dir.toFile());
        Process p = pb.start();
        try (OutputStream po = p.getOutputStream()) { po.write(stdin.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) {}
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        InputStream pi = p.getInputStream();
        Thread t = new Thread(() -> { try { byte[] b = new byte[8192]; int k; while ((k = pi.read(b)) > 0) if (saida.size() < 300000) saida.write(b, 0, k); } catch (IOException e) {} });
        t.start();
        boolean ok = p.waitFor(20, TimeUnit.SECONDS);
        if (!ok) { p.destroyForcibly(); p.waitFor(); }
        t.join();
        String r = saida.toString(StandardCharsets.UTF_8);
        if (!ok) return r + "[tempo esgotado]\n";
        return codigo ? r + "[código de saída: " + p.exitValue() + "]\n" : r;
    }
}
