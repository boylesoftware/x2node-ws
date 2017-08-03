"use strict";


/**
 * Pattern map implementation.
 *
 * @protected
 * @memberof module:x2node-ws
 * @inner
 */
class PatternMap {

	/**
	 * Single mapping descriptor fed to the pattern map constructor.
	 *
	 * @typedef {Object} module:x2node-ws~PatternMap~MappingDesc
	 * @property {string} pattern Pattern regular expression used to match the
	 * whole key (so no starting <code>^</code> nor ending <code>$</code> are
	 * necessary).
	 * @property {Object} value Corresponding value passed to the lookup callback
	 * if matched.
	 */

	/**
	 * Create new map.
	 *
	 * @param {Array.<module:x2node-ws~PatternMap~MappingDesc>} mappings Mapping
	 * descriptors.
	 */
	constructor(mappings) {

		this._mappingsIndex = new Array();

		this._mappings = mappings.map(mapping => {
			const patternRE = new RegExp(`^(?:${mapping.pattern})?$`);
			return {
				pattern: mapping.pattern,
				patternRE: patternRE,
				numParams: patternRE.exec('').length - 1,
				value: mapping.value
			};
		});

		this._mappingsReverse = this._mappings.concat().reverse();

		let master = '^(?:', mappingIndex = 0;
		for (let mapping of this._mappings) {
			if (mappingIndex > 0)
				master += '|';
			master += '(' + mapping.pattern + ')';
			this._mappingsIndex[mappingIndex] = mapping;
			mappingIndex += mapping.numParams + 1;
		}
		master += ')$';

		this._masterRE = new RegExp(master);
	}

	/**
	 * Value lookup callback.
	 *
	 * @callback module:x2node-ws~PatternMap~lookupCallback
	 * @param {Object} value Matched value.
	 * @param {Array.<string>} params Extracted pattern parameters.
	 */

	/**
	 * Lookup value matching the key. Only a single value is matched. The value
	 * matched is the first one in the mappings list provided to the map
	 * construtctor.
	 *
	 * @param {string} key The key.
	 * @param {module:x2node-ws~PatternMap~lookupCallback} [cb] Optional lookup
	 * success callback. Specifying the callback is the only way to get the
	 * pattern parameters extracted from the key.
	 * @returns {Object} The matched value, or <code>undefined</code> if lookup
	 * was unsuccessful.
	 */
	lookup(key, cb) {

		// match the key
		const match = this._masterRE.exec(key);
		if (!match)
			return;

		// find matched mapping in the index
		const matchInd = this._mappingsIndex.findIndex(
			(_, i) => match[i + 1]);
		const mapping = this._mappingsIndex[matchInd];

		// call the callback if any
		if (cb)
			cb(mapping.value, match.slice(
				matchInd + 2, matchInd + 2 + mapping.numParams));

		// return the value
		return mapping.value;
	}

	/**
	 * Lookup multiple values matching the key. For each matched value, the
	 * provided callback is invoked. The mappings are tested in reverse order to
	 * how they were provided to the map constructor.
	 *
	 * @param {string} key The key.
	 * @param {module:x2node-ws~PatternMap~lookupCallback} cb Lookup callback.
	 */
	lookupMultiReverse(key, cb) {

		// try mappings one by one on the key
		for (let mapping of this._mappingsReverse) {
			const match = mapping.patternRE.exec(key);
			if (match)
				cb(mapping.value, match.slice(1));
		}
	}
}

// export the class
module.exports = PatternMap;
