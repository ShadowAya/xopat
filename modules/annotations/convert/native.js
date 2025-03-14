OSDAnnotations.Convertor.register("native", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'xOpat Annotations';
    static description = 'Native Annotations Format';

    static includeAllAnnotationProps = false;

    static getSuffix() {
        return '.json';
    }

    static encodeFinalize(output) {
        return JSON.stringify({
            metadata: {
                version: OSDAnnotations.instance().version,
                created: Date.now(),
            },
            ...output
        });
    }

    async encodePartial(annotationsGetter, presetsGetter) {
        let annotations = this.options.exportsObjects ? annotationsGetter() : undefined;
        //todo consider as global-level option, data would arrive trimmed...
        let presets = this.filterUnusedPresets(annotations, this.options.exportsPresets ? presetsGetter() : undefined);
        if (this.options.serialize) {
            presets = presets ? JSON.stringify(presets) : undefined;
            annotations = annotations ? JSON.stringify(annotations) : undefined;
        }

        return {
            objects: annotations,
            presets: presets
        };
    }

    //todo some servers decode data :/ breaks api
    async decode(data) {
        return typeof data === "string" ? JSON.parse(data) : data;
    }
});
