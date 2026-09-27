import com.wind.meditor.core.FileProcesser;
import com.wind.meditor.property.AttributeItem;
import com.wind.meditor.property.ModificationProperty;
import com.wind.meditor.utils.NodeValue;

/** Small adapter around pinned ManifestEditor: edits binary AXML without rebuilding resources. */
public final class ManifestPatch {
    private static String replacePrefix(String value, String oldPackage, String newPackage) {
        if (value == null) return null;
        if (value.equals(oldPackage) || value.startsWith(oldPackage + ".")) {
            return newPackage + value.substring(oldPackage.length());
        }
        return value;
    }

    private static String replaceAuthorities(String value, String oldPackage, String newPackage) {
        String[] parts = value.split(";", -1);
        for (int i = 0; i < parts.length; i++) {
            parts[i] = replacePrefix(parts[i], oldPackage, newPackage);
        }
        return String.join(";", parts);
    }

    public static void main(String[] args) {
        if (args.length != 6) {
            throw new IllegalArgumentException(
                "usage: ManifestPatch INPUT_AXML OUTPUT_AXML OLD_PACKAGE NEW_PACKAGE VERSION_NAME VERSION_CODE");
        }
        int versionCode = Integer.parseInt(args[5]);
        ModificationProperty property = new ModificationProperty()
            .addManifestAttribute(new AttributeItem(NodeValue.Manifest.PACKAGE, args[3]).setNamespace(null))
            .addManifestAttribute(new AttributeItem(NodeValue.Manifest.VERSION_NAME, args[4]))
            .addManifestAttribute(new AttributeItem(NodeValue.Manifest.VERSION_CODE, versionCode))
            .setPermissionMapper((type, value) -> replacePrefix(value, args[2], args[3]))
            .setAuthorityMapper(value -> replaceAuthorities(value, args[2], args[3]));
        FileProcesser.processManifestFile(args[0], args[1], property);
    }
}
