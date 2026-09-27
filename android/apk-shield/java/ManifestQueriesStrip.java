import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import pxb.android.axml.AxmlReader;
import pxb.android.axml.AxmlVisitor;
import pxb.android.axml.AxmlWriter;
import pxb.android.axml.NodeVisitor;

/** Remove manifest queries subtrees (package visibility probes) for install-scan experiments. */
public final class ManifestQueriesStrip {
    static final class SkipSubtreeVisitor extends NodeVisitor {
        SkipSubtreeVisitor() {
            super(null);
        }

        @Override
        public void attr(String ns, String name, int resourceId, int type, Object value) {
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            return new SkipSubtreeVisitor();
        }

        @Override
        public void end() {
        }
    }

    static final class StripVisitor extends AxmlVisitor {
        StripVisitor(NodeVisitor writer) {
            super(writer);
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            if (name != null && (name.equals("queries") || name.endsWith(":queries"))) {
                return new SkipSubtreeVisitor();
            }
            return new StripVisitor(super.child(ns, name));
        }
    }

    public static void process(File input, File output) throws Exception {
        byte[] source = Files.readAllBytes(input.toPath());
        AxmlReader reader = new AxmlReader(source);
        AxmlWriter writer = new AxmlWriter();
        reader.accept(new StripVisitor(writer));
        Files.write(output.toPath(), writer.toByteArray());
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("Expected input.axml output.axml");
        }
        process(new File(args[0]), new File(args[1]));
    }
}
