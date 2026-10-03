import { mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformFileAsync } from "@babel/core";
import decorators from "@babel/plugin-proposal-decorators";

const root = new URL("../", import.meta.url);
await compileDirectory(new URL("destiny/", root), new URL("dist/destiny/", root));

/**
 * Compiles the owned Destiny tree, retaining native domain subdirectories.
 *
 * @param {URL} input Owned source directory.
 * @param {URL} output Corresponding generated output directory.
 * @returns {Promise<void>} Resolves when all owned JavaScript modules are compiled.
 */
async function compileDirectory(input, output)
{
    await mkdir(output, { recursive: true });
    for (const entry of await readdir(input, { withFileTypes: true }))
    {
        if (entry.isDirectory())
        {
            await compileDirectory(new URL(`${entry.name}/`, input), new URL(`${entry.name}/`, output));
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
        const result = await transformFileAsync(fileURLToPath(new URL(entry.name, input)), {
            babelrc: false,
            configFile: false,
            plugins: [[decorators, { version: "2023-11" }]],
            sourceMaps: true
        });
        await writeFile(new URL(entry.name, output), `${result.code}\n//# sourceMappingURL=${entry.name}.map\n`);
        await writeFile(new URL(`${entry.name}.map`, output), JSON.stringify(result.map));
    }
}
