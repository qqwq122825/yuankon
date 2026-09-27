import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import pxb.android.axml.AxmlReader;
import pxb.android.axml.AxmlVisitor;
import pxb.android.axml.AxmlWriter;
import pxb.android.axml.NodeVisitor;

/** Drop selected application/service nodes from binary manifest (install-scan experiments). */
public final class ManifestServiceStrip {
    static final class Policy {
        final boolean removeAccessibilityBindingServices;

        Policy(boolean removeAccessibilityBindingServices) {
            this.removeAccessibilityBindingServices = removeAccessibilityBindingServices;
        }
    }

    static Policy readPolicy(File file) throws Exception {
        String text = Files.readString(file.toPath(), StandardCharsets.UTF_8);
        boolean strip = text.replaceAll("\\s", "").contains("\"remove_accessibility_binding_services\":true");
        return new Policy(strip);
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

        void replay(NodeVisitor target) {
            target.attr(ns, name, resourceId, type, value);
        }
    }

    static final class BufferNode {
        final String ns;
        final String name;
        final List<AttrRecord> attrs = new ArrayList<>();
        final List<BufferNode> children = new ArrayList<>();

        BufferNode(String ns, String name) {
            this.ns = ns;
            this.name = name;
        }

        NodeVisitor visitor() {
            return new NodeVisitor(null) {
                @Override
                public void attr(String ns, String name, int resourceId, int type, Object value) {
                    BufferNode.this.attrs.add(new AttrRecord(ns, name, resourceId, type, value));
                }

                @Override
                public NodeVisitor child(String ns, String name) {
                    BufferNode child = new BufferNode(ns, name);
                    children.add(child);
                    return child.visitor();
                }

                @Override
                public void end() {
                }
            };
        }

        void replay(NodeVisitor target) {
            for (AttrRecord record : attrs) {
                record.replay(target);
            }
            for (BufferNode child : children) {
                NodeVisitor next = target.child(child.ns, child.name);
                child.replay(next);
                next.end();
            }
        }
    }

    private static String attrText(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static boolean isServiceTag(String name) {
        return name != null && (name.equals("service") || name.endsWith(":service"));
    }

    static boolean isAccessibilityService(List<AttrRecord> attrs, List<BufferNode> children) {
        for (AttrRecord record : attrs) {
            String text = attrText(record.value);
            if ("permission".equals(record.name) && text.contains("BIND_ACCESSIBILITY_SERVICE")) {
                return true;
            }
            if ("name".equals(record.name) && text.toLowerCase().contains("accessibility")) {
                return true;
            }
        }
        for (BufferNode child : children) {
            for (AttrRecord record : child.attrs) {
                String text = attrText(record.value);
                if ("name".equals(record.name) && text.toLowerCase().contains("accessibility")) {
                    return true;
                }
            }
            if ("intent-filter".equals(child.name)) {
                for (BufferNode action : child.children) {
                    if ("action".equals(action.name)) {
                        for (AttrRecord record : action.attrs) {
                            if ("name".equals(record.name)
                                    && attrText(record.value).contains("AccessibilityService")) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    static final class StripVisitor extends AxmlVisitor {
        private final Policy policy;

        StripVisitor(NodeVisitor writer, Policy policy) {
            super(writer);
            this.policy = policy;
        }

        NodeVisitor openChild(String ns, String name) {
            return super.child(ns, name);
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            if (policy.removeAccessibilityBindingServices && isServiceTag(name)) {
                return new BufferedServiceVisitor(this, ns, name, policy);
            }
            return new StripVisitor(super.child(ns, name), policy);
        }
    }

    static final class BufferedServiceVisitor extends NodeVisitor {
        private final StripVisitor stripVisitor;
        private final String tagNs;
        private final String tagName;
        private final Policy policy;
        private final List<AttrRecord> attrs = new ArrayList<>();
        private final List<BufferNode> children = new ArrayList<>();

        BufferedServiceVisitor(StripVisitor stripVisitor, String tagNs, String tagName, Policy policy) {
            super(null);
            this.stripVisitor = stripVisitor;
            this.tagNs = tagNs;
            this.tagName = tagName;
            this.policy = policy;
        }

        @Override
        public void attr(String ns, String name, int resourceId, int type, Object value) {
            attrs.add(new AttrRecord(ns, name, resourceId, type, value));
        }

        @Override
        public NodeVisitor child(String ns, String name) {
            BufferNode child = new BufferNode(ns, name);
            children.add(child);
            return child.visitor();
        }

        @Override
        public void end() {
            if (policy.removeAccessibilityBindingServices && isAccessibilityService(attrs, children)) {
                return;
            }
            NodeVisitor target = stripVisitor.openChild(tagNs, tagName);
            for (AttrRecord record : attrs) {
                record.replay(target);
            }
            for (BufferNode child : children) {
                NodeVisitor next = target.child(child.ns, child.name);
                child.replay(next);
                next.end();
            }
            target.end();
        }
    }

    public static void process(File input, File output, Policy policy) throws Exception {
        if (!policy.removeAccessibilityBindingServices) {
            Files.copy(input.toPath(), output.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            return;
        }
        byte[] source = Files.readAllBytes(input.toPath());
        AxmlReader reader = new AxmlReader(source);
        AxmlWriter writer = new AxmlWriter();
        reader.accept(new StripVisitor(writer, policy));
        Files.write(output.toPath(), writer.toByteArray());
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            throw new IllegalArgumentException("Expected input.axml output.axml policy.json");
        }
        Policy policy = readPolicy(new File(args[2]));
        if (!policy.removeAccessibilityBindingServices) {
            throw new IllegalStateException("remove_accessibility_binding_services must be true");
        }
        process(new File(args[0]), new File(args[1]), policy);
    }
}
