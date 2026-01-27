// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KeeperAutomation
 * @notice Chainlink Automation compatible contract for automated liquidations and funding settlements
 * @dev Implements AutomationCompatibleInterface for use with Chainlink Automation
 */

interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData) external returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

interface IPositionManager {
    struct Position {
        bool isLong;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 leverage;
        uint256 lastFundingTime;
        int256 accFundingFee;
    }

    function getPosition(address user) external view returns (Position memory);
    function canLiquidate(address user) external view returns (bool);
}

interface ILiquidation {
    function liquidate(address user) external;
    function canLiquidate(address user) external view returns (bool);
}

interface IFundingRate {
    function settleFunding() external;
    function getLastFundingTime() external view returns (uint256);
}

contract KeeperAutomation is AutomationCompatibleInterface, Ownable, ReentrancyGuard {
    // =============================================================
    // State Variables
    // =============================================================

    IPositionManager public positionManager;
    ILiquidation public liquidation;
    IFundingRate public fundingRate;

    // Tracked users with positions
    address[] public trackedUsers;
    mapping(address => bool) public isTracked;
    mapping(address => uint256) public userIndex;

    // Funding rate settings
    uint256 public constant FUNDING_INTERVAL = 4 hours;
    uint256 public lastFundingCheck;

    // Automation settings
    uint256 public maxLiquidationsPerUpkeep = 5;
    uint256 public minGasForLiquidation = 300000;

    // Metrics
    uint256 public totalLiquidations;
    uint256 public totalFundingSettlements;

    // =============================================================
    // Events
    // =============================================================

    event UserTracked(address indexed user);
    event UserUntracked(address indexed user);
    event LiquidationExecuted(address indexed user, address indexed liquidator);
    event FundingSettled(uint256 timestamp);
    event ConfigUpdated(string param, uint256 value);

    // =============================================================
    // Constructor
    // =============================================================

    constructor(
        address _positionManager,
        address _liquidation,
        address _fundingRate
    ) Ownable(msg.sender) {
        positionManager = IPositionManager(_positionManager);
        liquidation = ILiquidation(_liquidation);
        fundingRate = IFundingRate(_fundingRate);
        lastFundingCheck = block.timestamp;
    }

    // =============================================================
    // Chainlink Automation Interface
    // =============================================================

    /**
     * @notice Check if upkeep is needed
     * @dev Called by Chainlink Automation nodes to check if performUpkeep should be called
     * @param checkData Not used in this implementation
     * @return upkeepNeeded True if upkeep is needed
     * @return performData Encoded data for performUpkeep
     */
    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Check 1: Any positions need liquidation?
        address[] memory usersToLiquidate = new address[](maxLiquidationsPerUpkeep);
        uint256 count = 0;

        for (uint256 i = 0; i < trackedUsers.length && count < maxLiquidationsPerUpkeep; i++) {
            address user = trackedUsers[i];
            try positionManager.canLiquidate(user) returns (bool canLiq) {
                if (canLiq) {
                    usersToLiquidate[count] = user;
                    count++;
                }
            } catch {
                // Skip on error
            }
        }

        if (count > 0) {
            // Trim array to actual size
            address[] memory trimmed = new address[](count);
            for (uint256 i = 0; i < count; i++) {
                trimmed[i] = usersToLiquidate[i];
            }
            return (true, abi.encode(uint8(1), trimmed)); // 1 = liquidation
        }

        // Check 2: Is it time for funding settlement?
        if (_isFundingTime()) {
            return (true, abi.encode(uint8(2), new address[](0))); // 2 = funding
        }

        return (false, "");
    }

    /**
     * @notice Perform the upkeep
     * @dev Called by Chainlink Automation when checkUpkeep returns true
     * @param performData Encoded data from checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external override nonReentrant {
        (uint8 actionType, address[] memory users) = abi.decode(performData, (uint8, address[]));

        if (actionType == 1) {
            // Execute liquidations
            for (uint256 i = 0; i < users.length; i++) {
                if (gasleft() < minGasForLiquidation) break;

                address user = users[i];
                try liquidation.liquidate(user) {
                    totalLiquidations++;
                    emit LiquidationExecuted(user, msg.sender);

                    // Remove from tracked if position is closed
                    _checkAndRemoveUser(user);
                } catch {
                    // Continue on failure
                }
            }
        } else if (actionType == 2) {
            // Execute funding settlement
            if (_isFundingTime()) {
                try fundingRate.settleFunding() {
                    totalFundingSettlements++;
                    lastFundingCheck = block.timestamp;
                    emit FundingSettled(block.timestamp);
                } catch {
                    // Log failure but don't revert
                }
            }
        }
    }

    // =============================================================
    // User Tracking
    // =============================================================

    /**
     * @notice Track a user for liquidation monitoring
     * @param user Address to track
     */
    function trackUser(address user) external {
        require(!isTracked[user], "Already tracked");

        // Verify user has a position
        IPositionManager.Position memory pos = positionManager.getPosition(user);
        require(pos.size > 0, "No position");

        trackedUsers.push(user);
        userIndex[user] = trackedUsers.length - 1;
        isTracked[user] = true;

        emit UserTracked(user);
    }

    /**
     * @notice Batch track multiple users
     * @param users Array of addresses to track
     */
    function trackUsers(address[] calldata users) external {
        for (uint256 i = 0; i < users.length; i++) {
            if (!isTracked[users[i]]) {
                IPositionManager.Position memory pos = positionManager.getPosition(users[i]);
                if (pos.size > 0) {
                    trackedUsers.push(users[i]);
                    userIndex[users[i]] = trackedUsers.length - 1;
                    isTracked[users[i]] = true;
                    emit UserTracked(users[i]);
                }
            }
        }
    }

    /**
     * @notice Untrack a user
     * @param user Address to untrack
     */
    function untrackUser(address user) external {
        require(isTracked[user], "Not tracked");
        _removeUser(user);
    }

    // =============================================================
    // Internal Functions
    // =============================================================

    function _isFundingTime() internal view returns (bool) {
        uint256 currentHour = (block.timestamp / 1 hours) % 24;
        bool isSettlementHour = currentHour == 0 || currentHour == 4 ||
                                currentHour == 8 || currentHour == 12 ||
                                currentHour == 16 || currentHour == 20;

        return isSettlementHour &&
               (block.timestamp - lastFundingCheck) >= (FUNDING_INTERVAL - 5 minutes);
    }

    function _checkAndRemoveUser(address user) internal {
        IPositionManager.Position memory pos = positionManager.getPosition(user);
        if (pos.size == 0 && isTracked[user]) {
            _removeUser(user);
        }
    }

    function _removeUser(address user) internal {
        uint256 index = userIndex[user];
        uint256 lastIndex = trackedUsers.length - 1;

        if (index != lastIndex) {
            address lastUser = trackedUsers[lastIndex];
            trackedUsers[index] = lastUser;
            userIndex[lastUser] = index;
        }

        trackedUsers.pop();
        delete userIndex[user];
        isTracked[user] = false;

        emit UserUntracked(user);
    }

    // =============================================================
    // Admin Functions
    // =============================================================

    function setContracts(
        address _positionManager,
        address _liquidation,
        address _fundingRate
    ) external onlyOwner {
        if (_positionManager != address(0)) {
            positionManager = IPositionManager(_positionManager);
        }
        if (_liquidation != address(0)) {
            liquidation = ILiquidation(_liquidation);
        }
        if (_fundingRate != address(0)) {
            fundingRate = IFundingRate(_fundingRate);
        }
    }

    function setMaxLiquidationsPerUpkeep(uint256 _max) external onlyOwner {
        maxLiquidationsPerUpkeep = _max;
        emit ConfigUpdated("maxLiquidationsPerUpkeep", _max);
    }

    function setMinGasForLiquidation(uint256 _minGas) external onlyOwner {
        minGasForLiquidation = _minGas;
        emit ConfigUpdated("minGasForLiquidation", _minGas);
    }

    // =============================================================
    // View Functions
    // =============================================================

    function getTrackedUsersCount() external view returns (uint256) {
        return trackedUsers.length;
    }

    function getTrackedUsers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        uint256 end = offset + limit;
        if (end > trackedUsers.length) {
            end = trackedUsers.length;
        }

        address[] memory users = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            users[i - offset] = trackedUsers[i];
        }
        return users;
    }

    function getUsersNeedingLiquidation() external view returns (address[] memory) {
        address[] memory temp = new address[](trackedUsers.length);
        uint256 count = 0;

        for (uint256 i = 0; i < trackedUsers.length; i++) {
            try positionManager.canLiquidate(trackedUsers[i]) returns (bool canLiq) {
                if (canLiq) {
                    temp[count] = trackedUsers[i];
                    count++;
                }
            } catch {}
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }
        return result;
    }

    function getMetrics() external view returns (
        uint256 _totalLiquidations,
        uint256 _totalFundingSettlements,
        uint256 _trackedUsers,
        uint256 _lastFundingCheck
    ) {
        return (
            totalLiquidations,
            totalFundingSettlements,
            trackedUsers.length,
            lastFundingCheck
        );
    }
}
