import com.wind.meditor.core.FileProcesser;
import com.wind.meditor.property.AttributeItem;
import com.wind.meditor.property.ModificationProperty;
import com.wind.meditor.utils.NodeValue;

/** Override application label (and optionally versionName) in binary manifest for scan probes. */
public final class ManifestApplicationPatch {
    public static void main(String[] args) {
        if (args.length < 3) {
            throw new IllegalArgumentException("Expected input.axml output.axml label [versionName]");
        }
        ModificationProperty changes = new ModificationProperty()
            .addApplicationAttribute(new AttributeItem(NodeValue.Application.LABEL, args[2]));
        if (args.length >= 4 && !args[3].isEmpty()) {
            changes.addManifestAttribute(new AttributeItem(NodeValue.Manifest.VERSION_NAME, args[3]));
        }
        FileProcesser.processManifestFile(args[0], args[1], changes);
    }
}
