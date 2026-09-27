import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import pxb.android.axml.AxmlReader;
import pxb.android.axml.AxmlVisitor;
import pxb.android.axml.AxmlWriter;
import pxb.android.axml.NodeVisitor;

/** Remove selected uses-permission / permission nodes from binary AXML (ManifestEditor stack). */
public final class ManifestPermissionStrip {
    private static final Pattern PERMS = Pattern.compile("\"([^\"]+)\"");

    static final class Policy {
        final String mode;
        final Set<String> permissions;
        final boolean removePermissionDeclarations;

        Policy(String mode, Set<String> permissions, boolean removePermissionDeclarations) {
            this.mode = mode == null ? "remove_all" : mode;
            this.permissions = permissions == null ? Set.of() : permissions;
            this.removePermissionDeclarations = removePermissionDeclarations;
        }

        boolean shouldDropUsesPermission(String name) {
            if (name == null || name.isEmpty()) {
                return true;
            }
            return switch (mode) {
                case "keep_only" -> !permissions.contains(name);
                case "remove_list" -> permissions.contains(name);
                case "remove_all" -> true;
                default -> throw new IllegalArgumentException("Unknown mode: " + mode);
            };
        }
    }

    static Policy readPolicy(File file) throws Exception {
        String text = Files.readString(file.toPath(), StandardCharsets.UTF_8);
        String mode = match(text, "\"mode\"\\s*:\\s*\"([^\"]+)\"");
        boolean removeDecl = text.contains("\"remove_permission_declarations\"")
            && text.replaceAll("\\s", "").contains("\"remove_permission_declarations\":true");
        Set<String> perms = new HashSet<>();
        Matcher list = Pattern.compile("\"permissions\"\\s*:\\s*\\[(.*?)\\]", Pattern.DOTALL).matcher(text);
        if (list.find()) {
            Matcher item = PERMS.matcher(list.group(1));
            while (item.find()) {
                perms.add(item.group(1));
            }
        }
        return new Policy(mode, perms, removeDecl);
    }

    private static String match(String text, String regex) {
        Matcher matcher = Pattern.compile(regex).matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    /** Consume subtree without writing any node (avoids empty permission stubs). */
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

        @Override
        public void line(int num) {
        }

        @Override
        public void text(int lineNumber, String value) {
        }
    }

    static final class AttrRecord {
        final String ns;
        final String name;
        final int resourceId;
        final int type;
        final Object value;

        AttrRecord(String ns, String name, int resourceId, int type, Object value) {
            this.ns = ns;
            this.name = name;
            this.resourceId = resourceId;
            this.type = type;
            this.value = value;
        }
    }

    /** Buffer attrs until end; only then open the output node if kept. */
    static final class LazyUsesPermissionVisitor extends NodeVisitor {
        private final ManifestChildrenVisitor manifestVisitor;
        private final String tagNs;
        private final String tagName;
        private final Policy policy;
        private final List<AttrRecord> attrs = new ArrayList<>();
        private boolean drop;

        LazyUsesPermissionVisitor(ManifestChildrenVisitor manifestVisitor, String tagNs, String tagName,
                                  Policy policy) {
            super(null);
            this.manifestVisitor = manifestVisitor;
            this.tagNs = tagNs;
            this.tagName = tagName;
            this.policy = policy;
        }

        @Override
        public void attr(String ns, String name, int resourceId, int type, Object value) {
            attrs.add(new AttrRecord(ns, name, resourceId, type, value));
            if ("name".equals(name) && value instanceof String) {
                drop = policy.shouldDropUsesPermission((String) value);
            }
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            return new SkipSubtreeVisitor();
        }

        @Override
        public void end() {
            if (attrs.isEmpty()) {
                drop = true;
            }
            if (drop) {
                return;
            }
            NodeVisitor target = manifestVisitor.openChild(tagNs, tagName);
            for (AttrRecord record : attrs) {
                target.attr(record.ns, record.name, record.resourceId, record.type, record.value);
            }
            target.end();
        }
    }

    static final class ManifestChildrenVisitor extends NodeVisitor {
        private final Policy policy;

        ManifestChildrenVisitor(NodeVisitor parent, Policy policy) {
            super(parent);
            this.policy = policy;
        }

        NodeVisitor openChild(String ns, String name) {
            return super.child(ns, name);
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            if (isUsesPermissionTag(name)) {
                return new LazyUsesPermissionVisitor(this, ns, name, policy);
            }
            if ("permission".equals(name) && policy.removePermissionDeclarations) {
                return new SkipSubtreeVisitor();
            }
            return super.child(ns, name);
        }

        private static boolean isUsesPermissionTag(String name) {
            return "uses-permission".equals(name) || "uses-permission-sdk-23".equals(name);
        }
    }

    public static void process(File input, File output, Policy policy) throws Exception {
        byte[] source = Files.readAllBytes(input.toPath());
        AxmlReader reader = new AxmlReader(source);
        AxmlWriter writer = new AxmlWriter();
        reader.accept(new AxmlVisitor(writer) {
            @Override
            public NodeVisitor child(String ns, String name) {
                NodeVisitor next = super.child(ns, name);
                if ("manifest".equals(name)) {
                    return new ManifestChildrenVisitor(next, policy);
                }
                return next;
            }
        });
        Files.write(output.toPath(), writer.toByteArray());
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            throw new IllegalArgumentException("Expected input.axml output.axml policy.json");
        }
        Policy policy = readPolicy(new File(args[2]));
        process(new File(args[0]), new File(args[1]), policy);
    }
}
