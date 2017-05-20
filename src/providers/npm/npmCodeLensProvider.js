/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Peter Flannery. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { AbstractCodeLensProvider } from '../abstractCodeLensProvider';
import { npmPackageParser } from './npmPackageParser';
import { appConfig } from '../../common/appConfiguration';
import * as CommandFactory from '../commandFactory';
import { npmGetOutdated, npmPackageDirExists } from './npmAPI';
import { extractDependencyNodes, parseDependencyNodes } from '../../common/dependencyParser';
import { generateCodeLenses } from '../../common/codeLensGeneration';
import appSettings from '../../common/appSettings';
import {
  renderMissingDecoration,
  renderInstalledDecoration,
  renderOutdatedDecoration,
  renderNeedsUpdateDecoration,
  renderPrereleaseInstalledDecoration
} from '../../editor/decorations';

const { window } = require('vscode');
const jsonParser = require('vscode-contrib-jsonc');
const path = require('path');

export class NpmCodeLensProvider extends AbstractCodeLensProvider {

  _outdatedCache = [];
  _documentPath = '';

  get selector() {
    return {
      language: 'json',
      scheme: 'file',
      pattern: '**/package.json'
    }
  }

  provideCodeLenses(document, token) {
    if (appSettings.showVersionLenses === false)
      return;

    this._documentPath = path.dirname(document.uri.fsPath);

    const jsonDoc = jsonParser.parse(document.getText());
    if (!jsonDoc || !jsonDoc.root || jsonDoc.validationResult.errors.length > 0)
      return [];

    const dependencyNodes = extractDependencyNodes(
      jsonDoc.root,
      appConfig.npmDependencyProperties
    );

    const packageCollection = parseDependencyNodes(
      dependencyNodes,
      appConfig,
      npmPackageParser
    );

    appSettings.inProgress = true;
    return this.updateOutdated()
      .then(_ => {
        appSettings.inProgress = false;
        return generateCodeLenses(packageCollection, document)
      })
      .catch(err => {
        console.log(err)
      });
  }

  evaluateCodeLens(codeLens) {
    if (codeLens.package.meta) {
      if (codeLens.package.meta.type === 'github')
        return CommandFactory.createGithubCommand(codeLens);

      if (codeLens.package.meta.type === 'file')
        return CommandFactory.createLinkCommand(codeLens);
    }

    // check if this package was found
    if (codeLens.packageNotFound())
      return CommandFactory.createPackageNotFoundCommand(codeLens);

    // check if this package is supported
    if (codeLens.packageNotSupported())
      return CommandFactory.createPackageNotSupportedCommand(codeLens);

    // check if this is a tagged version
    if (codeLens.isTaggedVersion())
      return CommandFactory.createTaggedVersionCommand(codeLens);

    // generate decoration
    if (appSettings.showDependencyStatuses)
      this.generateDecoration(codeLens);

    // check if the entered version is valid
    if (codeLens.isInvalidVersion())
      return CommandFactory.createInvalidCommand(codeLens);

    // check if this entered versions matches a registry versions
    if (codeLens.versionMatchNotFound())
      return CommandFactory.createVersionMatchNotFoundCommand(codeLens);

    // check if this matches prerelease version
    if (codeLens.matchesPrereleaseVersion())
      return CommandFactory.createMatchesPrereleaseVersionCommand(codeLens);

    // check if this is the latest version
    if (codeLens.matchesLatestVersion())
      return CommandFactory.createMatchesLatestVersionCommand(codeLens);

    // check if this satisfies the latest version
    if (codeLens.satisfiesLatestVersion())
      return CommandFactory.createSatisfiesLatestVersionCommand(codeLens);

    // check if this is a fixed version
    if (codeLens.isFixedVersion())
      return CommandFactory.createFixedVersionCommand(codeLens);

    const tagVersion = codeLens.getTaggedVersion();
    return CommandFactory.createVersionCommand(
      codeLens.package.version,
      tagVersion,
      codeLens
    );
  }

  // get the outdated packages and cache them
  updateOutdated() {
    return npmGetOutdated(this._documentPath)
      .then(results => this._outdatedCache = results)
      .catch(err => {
        console.log("npmGetOutdated", err)
      });
  }

  generateDecoration(codeLens) {
    const activeEditor = window.activeTextEditor;
    const documentPath = this._documentPath;
    const currentPackageName = codeLens.package.name;

    const packageDirExists = npmPackageDirExists(documentPath, currentPackageName);
    if (!packageDirExists) {
      renderMissingDecoration(codeLens.replaceRange);
      return;
    }

    Promise.resolve(this._outdatedCache)
      .then(outdated => {
        const findIndex = outdated.findIndex(
          entry => entry.name === currentPackageName
        );

        if (findIndex === -1) {
          renderInstalledDecoration(
            codeLens.replaceRange,
            codeLens.package.meta.tag.version
          );
          return;
        }

        const current = outdated[findIndex].current;
        const entered = codeLens.package.meta.tag.version;

        // no current means no install at all
        if (!current) {
          renderMissingDecoration(
            codeLens.replaceRange
          );
          return;
        }

        // if npm current and the entered version match it's installed
        if (current === entered) {

          if (codeLens.matchesLatestVersion())
            // up to date
            renderInstalledDecoration(
              codeLens.replaceRange,
              current,
              entered
            );
          else if (codeLens.matchesPrereleaseVersion())
            // ahead of latest
            renderPrereleaseInstalledDecoration(
              codeLens.replaceRange,
              entered
            );
          else
            // out of date
            renderOutdatedDecoration(
              codeLens.replaceRange,
              current
            );

          return;
        }

        // signal needs update
        renderNeedsUpdateDecoration(
          codeLens.replaceRange,
          current
        );

      })
      .catch(console.error);

  }

} // End NpmCodeLensProvider
