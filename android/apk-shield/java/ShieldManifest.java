import com.wind.meditor.core.FileProcesser;
import com.wind.meditor.property.AttributeItem;
import com.wind.meditor.property.ModificationProperty;

/** Only add the factory and, when explicitly selected, raise the minimum SDK. */
public final class ShieldManifest {
    public static void main(String[] args) {
        if (args.length != 4) throw new IllegalArgumentException("Expected input, output, factory, minimum SDK");
        ModificationProperty changes = new ModificationProperty()
            .addApplicationAttribute(new AttributeItem("appComponentFactory", args[2])
                .setResourceId(16844154))
            .addUsesSdkAttribute(new AttributeItem("minSdkVersion", Integer.parseInt(args[3]))
                .setResourceId(16843276).setType(16));
        FileProcesser.processManifestFile(args[0], args[1], changes);
    }
}
